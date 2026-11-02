-- Migration 025: Labs - Tenant Suspension Support
-- Adds automatic suspension/reactivation when subscription_status changes
-- Assumes tables already exist from LMS migrations 023/024

-- Add subscription_status field if not exists (may already exist from LMS)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'lab_tenants' 
        AND column_name = 'subscription_status'
    ) THEN
        ALTER TABLE lab_tenants 
        ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active';
        
        CREATE INDEX idx_lab_tenants_subscription_status ON lab_tenants(subscription_status);
        
        COMMENT ON COLUMN lab_tenants.subscription_status IS 'Subscription/billing status: active, suspended, cancelled, expired';
    END IF;
END $$;

-- Function to suspend all labs for a tenant
CREATE OR REPLACE FUNCTION suspend_tenant_labs(p_tenant_id UUID)
RETURNS TABLE (
    suspended_count INTEGER,
    workspace_ids UUID[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- Function to reactivate labs when tenant subscription is restored
CREATE OR REPLACE FUNCTION reactivate_tenant_labs(p_tenant_id UUID)
RETURNS TABLE (
    reactivated_count INTEGER,
    workspace_ids UUID[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reactivated_count INTEGER;
    v_workspace_ids UUID[];
BEGIN
    -- Get all workspace IDs for this tenant
    SELECT ARRAY_AGG(id) INTO v_workspace_ids
    FROM lab_workspaces
    WHERE tenant_id = p_tenant_id;
    
    -- Restore labs to their previous status
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
$$;

-- Function to check if tenant subscription is active (for use in RLS or app logic)
CREATE OR REPLACE FUNCTION is_tenant_subscription_active(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM lab_tenants 
        WHERE id = p_tenant_id 
        AND subscription_status = 'active'
    );
END;
$$;

-- Trigger function to handle subscription status changes
CREATE OR REPLACE FUNCTION handle_tenant_subscription_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

-- Create trigger if not exists
DROP TRIGGER IF EXISTS tenant_subscription_change_trigger ON lab_tenants;
CREATE TRIGGER tenant_subscription_change_trigger
    AFTER UPDATE OF subscription_status ON lab_tenants
    FOR EACH ROW
    WHEN (OLD.subscription_status IS DISTINCT FROM NEW.subscription_status)
    EXECUTE FUNCTION handle_tenant_subscription_change();

-- Grant execute permissions to authenticated users (adjust as needed)
GRANT EXECUTE ON FUNCTION suspend_tenant_labs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_tenant_labs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_tenant_subscription_active(UUID) TO authenticated;
