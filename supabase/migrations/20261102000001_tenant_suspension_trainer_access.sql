-- Migration 024: Tenant Suspension and Trainer Access
-- This migration adds subscription status tracking and trainer access policies

-- Add subscription_status to lab_tenants
ALTER TABLE lab_tenants 
ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';
-- subscription_status: active, suspended, cancelled, expired

-- Update status column comment for clarity (status is now workspace/tenant operational status)
COMMENT ON COLUMN lab_tenants.status IS 'Operational status: active, suspended, expired';
COMMENT ON COLUMN lab_tenants.subscription_status IS 'Subscription/billing status: active, suspended, cancelled, expired';

-- Add index for subscription status queries
CREATE INDEX IF NOT EXISTS idx_lab_tenants_subscription_status ON lab_tenants(subscription_status);

-- Add 'suspended' as a valid status for workspace resources
-- (Already supported in code, this is documentation)
COMMENT ON COLUMN lab_workspace_resources.status IS 'Resource status: provisioning, ready, stopped, suspended, failed, expired, revoked, deleted';

-- Enhanced RLS Policies for Trainer Access
-- Trainers can view their workspace members and their labs

-- Policy: Trainers can view members in their assigned workspaces
DROP POLICY IF EXISTS "Trainers can view their workspace members" ON lab_workspace_members;
CREATE POLICY "Trainers can view their workspace members"
    ON lab_workspace_members FOR SELECT
    USING (
        -- User is a member of the workspace's tenant
        workspace_id IN (
            SELECT id FROM lab_workspaces 
            WHERE tenant_id IN (
                SELECT tenant_id FROM lab_tenant_users 
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
        OR
        -- User is the trainer assigned to this workspace
        workspace_id IN (
            SELECT id FROM lab_workspaces
            WHERE trainer_user_id = auth.uid()
        )
    );

-- Policy: Trainers can view resources in their assigned workspaces
DROP POLICY IF EXISTS "Users can view resources in their workspaces" ON lab_workspace_resources;
CREATE POLICY "Users can view resources in their workspaces"
    ON lab_workspace_resources FOR SELECT
    USING (
        -- User's own resources
        user_id = auth.uid()
        OR
        -- Resources in workspaces where user is a tenant member
        workspace_id IN (
            SELECT id FROM lab_workspaces 
            WHERE tenant_id IN (
                SELECT tenant_id FROM lab_tenant_users 
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
        OR
        -- Resources in workspaces where user is the assigned trainer
        workspace_id IN (
            SELECT id FROM lab_workspaces
            WHERE trainer_user_id = auth.uid()
        )
    );

-- Policy: Trainers can view their assigned workspaces
DROP POLICY IF EXISTS "Users can view workspaces in their tenants" ON lab_workspaces;
CREATE POLICY "Users can view workspaces in their tenants"
    ON lab_workspaces FOR SELECT
    USING (
        -- Workspaces in user's tenants
        tenant_id IN (
            SELECT tenant_id FROM lab_tenant_users 
            WHERE user_id = auth.uid() AND status = 'active'
        )
        OR
        -- Workspaces where user is the assigned trainer
        trainer_user_id = auth.uid()
    );

-- Function to check if tenant subscription is active
CREATE OR REPLACE FUNCTION is_tenant_subscription_active(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM lab_tenants 
        WHERE id = p_tenant_id 
        AND subscription_status = 'active'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to suspend all labs for a tenant
CREATE OR REPLACE FUNCTION suspend_tenant_labs(p_tenant_id UUID)
RETURNS TABLE (
    suspended_count INTEGER,
    workspace_ids UUID[]
) AS $$
DECLARE
    v_suspended_count INTEGER;
    v_workspace_ids UUID[];
BEGIN
    -- Get all workspace IDs for this tenant
    SELECT ARRAY_AGG(id) INTO v_workspace_ids
    FROM lab_workspaces
    WHERE tenant_id = p_tenant_id;
    
    -- Update all running labs to suspended status
    UPDATE lab_workspace_resources
    SET 
        status = 'suspended',
        usage = COALESCE(usage, '{}'::jsonb) || jsonb_build_object(
            'suspended_at', NOW()::text,
            'previous_status', status,
            'suspension_reason', 'tenant_subscription_inactive'
        ),
        updated_at = NOW()
    WHERE workspace_id = ANY(v_workspace_ids)
    AND status IN ('provisioning', 'ready', 'stopped')
    AND deleted_at IS NULL;
    
    GET DIAGNOSTICS v_suspended_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_suspended_count, v_workspace_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reactivate labs when tenant subscription is restored
CREATE OR REPLACE FUNCTION reactivate_tenant_labs(p_tenant_id UUID)
RETURNS TABLE (
    reactivated_count INTEGER,
    workspace_ids UUID[]
) AS $$
DECLARE
    v_reactivated_count INTEGER;
    v_workspace_ids UUID[];
BEGIN
    -- Get all workspace IDs for this tenant
    SELECT ARRAY_AGG(id) INTO v_workspace_ids
    FROM lab_workspaces
    WHERE tenant_id = p_tenant_id;
    
    -- Restore labs to their previous status (or 'stopped' if previous status was 'provisioning')
    UPDATE lab_workspace_resources
    SET 
        status = CASE 
            WHEN usage->>'previous_status' = 'provisioning' THEN 'stopped'
            WHEN usage->>'previous_status' IN ('ready', 'stopped') THEN usage->>'previous_status'
            ELSE 'stopped'
        END,
        usage = COALESCE(usage, '{}'::jsonb) || jsonb_build_object(
            'reactivated_at', NOW()::text
        ),
        updated_at = NOW()
    WHERE workspace_id = ANY(v_workspace_ids)
    AND status = 'suspended'
    AND deleted_at IS NULL;
    
    GET DIAGNOSTICS v_reactivated_count = ROW_COUNT;
    
    RETURN QUERY SELECT v_reactivated_count, v_workspace_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically suspend/reactivate labs when tenant subscription changes
CREATE OR REPLACE FUNCTION handle_tenant_subscription_change()
RETURNS TRIGGER AS $$
BEGIN
    -- If subscription became inactive, suspend all labs
    IF OLD.subscription_status = 'active' AND NEW.subscription_status != 'active' THEN
        PERFORM suspend_tenant_labs(NEW.id);
        RAISE NOTICE 'Suspended labs for tenant %', NEW.id;
    END IF;
    
    -- If subscription became active, reactivate suspended labs
    IF OLD.subscription_status != 'active' AND NEW.subscription_status = 'active' THEN
        PERFORM reactivate_tenant_labs(NEW.id);
        RAISE NOTICE 'Reactivated labs for tenant %', NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on tenant subscription status changes
DROP TRIGGER IF EXISTS tenant_subscription_change_trigger ON lab_tenants;
CREATE TRIGGER tenant_subscription_change_trigger
    AFTER UPDATE OF subscription_status ON lab_tenants
    FOR EACH ROW
    WHEN (OLD.subscription_status IS DISTINCT FROM NEW.subscription_status)
    EXECUTE FUNCTION handle_tenant_subscription_change();
