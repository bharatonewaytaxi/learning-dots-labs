-- Migration 023: Lab Shared Tenancy Model
-- This migration creates the lab tenancy infrastructure for workspace-based lab management

-- Create lab_tenants table
CREATE TABLE IF NOT EXISTS lab_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free', -- free, pro, enterprise
    starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'active', -- active, suspended, expired
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create lab_tenant_users table (junction table for tenant members)
CREATE TABLE IF NOT EXISTS lab_tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES lab_tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'invited', -- invited, active, removed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

-- Create lab_user_roles table
CREATE TABLE IF NOT EXISTS lab_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES lab_tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role_key TEXT NOT NULL, -- tenantadmin, member
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id, role_key)
);

-- Create lab_workspaces table
CREATE TABLE IF NOT EXISTS lab_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES lab_tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    trainer_user_id UUID, -- The trainer assigned to this workspace
    course_id TEXT, -- Reference to master course list
    start_date DATE,
    end_date DATE,
    status TEXT NOT NULL DEFAULT 'active', -- active, closed, archived
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create lab_workspace_members table
CREATE TABLE IF NOT EXISTS lab_workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES lab_workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'learner', -- trainer, learner, observer
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active', -- active, removed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- Create lab_workspace_resources table (NEW)
CREATE TABLE IF NOT EXISTS lab_workspace_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES lab_workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- The learner this lab is assigned to
    kind TEXT NOT NULL, -- lab, vm, container, etc.
    external_ref TEXT NOT NULL, -- VM ID, lab ID, or other external identifier
    status TEXT NOT NULL DEFAULT 'provisioning', -- provisioning, ready, stopped, expired, deleted
    usage JSONB DEFAULT '{}', -- Track usage metrics (connection_count, last_accessed, etc.)
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lab_tenant_users_tenant ON lab_tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_tenant_users_user ON lab_tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_user_roles_tenant ON lab_user_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_user_roles_user ON lab_user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspaces_tenant ON lab_workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspaces_trainer ON lab_workspaces(trainer_user_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_members_workspace ON lab_workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_members_user ON lab_workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_resources_workspace ON lab_workspace_resources(workspace_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_resources_user ON lab_workspace_resources(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_resources_status ON lab_workspace_resources(status);
CREATE INDEX IF NOT EXISTS idx_lab_workspace_resources_external ON lab_workspace_resources(external_ref);

-- Enable Row Level Security
ALTER TABLE lab_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_workspace_resources ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lab_tenants
-- Users can see tenants they belong to
CREATE POLICY "Users can view their tenants"
    ON lab_tenants FOR SELECT
    USING (
        id IN (
            SELECT tenant_id FROM lab_tenant_users 
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- RLS Policies for lab_tenant_users
CREATE POLICY "Users can view tenant members of their tenants"
    ON lab_tenant_users FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM lab_tenant_users 
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- RLS Policies for lab_user_roles
CREATE POLICY "Users can view roles in their tenants"
    ON lab_user_roles FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM lab_tenant_users 
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- RLS Policies for lab_workspaces
CREATE POLICY "Users can view workspaces in their tenants"
    ON lab_workspaces FOR SELECT
    USING (
        tenant_id IN (
            SELECT tenant_id FROM lab_tenant_users 
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- RLS Policies for lab_workspace_members
CREATE POLICY "Users can view members of workspaces in their tenants"
    ON lab_workspace_members FOR SELECT
    USING (
        workspace_id IN (
            SELECT id FROM lab_workspaces 
            WHERE tenant_id IN (
                SELECT tenant_id FROM lab_tenant_users 
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
    );

-- RLS Policies for lab_workspace_resources
CREATE POLICY "Users can view resources in their workspaces"
    ON lab_workspace_resources FOR SELECT
    USING (
        workspace_id IN (
            SELECT id FROM lab_workspaces 
            WHERE tenant_id IN (
                SELECT tenant_id FROM lab_tenant_users 
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
        OR user_id = auth.uid()
    );

-- Create master courses table for course definitions
CREATE TABLE IF NOT EXISTS lab_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    duration_hours INTEGER,
    lab_templates JSONB DEFAULT '[]', -- Array of lab configuration templates
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for courses (publicly readable)
ALTER TABLE lab_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active courses"
    ON lab_courses FOR SELECT
    USING (active = true);

-- Create index for course lookups
CREATE INDEX IF NOT EXISTS idx_lab_courses_course_id ON lab_courses(course_id);

-- Insert some sample courses
INSERT INTO lab_courses (course_id, name, description, duration_hours, lab_templates) VALUES
    ('k8s-fundamentals', 'Kubernetes Fundamentals', 'Introduction to Kubernetes orchestration', 40, '[{"name": "k8s-cluster", "type": "kubernetes", "nodes": 3}]'),
    ('docker-basics', 'Docker Basics', 'Learn containerization with Docker', 20, '[{"name": "docker-host", "type": "vm", "image": "ubuntu-docker"}]'),
    ('cloud-devops', 'Cloud DevOps', 'DevOps practices in cloud environments', 60, '[{"name": "cloud-lab", "type": "cloud", "provider": "aws"}]')
ON CONFLICT (course_id) DO NOTHING;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
CREATE TRIGGER update_lab_tenants_updated_at BEFORE UPDATE ON lab_tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_tenant_users_updated_at BEFORE UPDATE ON lab_tenant_users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_workspaces_updated_at BEFORE UPDATE ON lab_workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_workspace_members_updated_at BEFORE UPDATE ON lab_workspace_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_workspace_resources_updated_at BEFORE UPDATE ON lab_workspace_resources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lab_courses_updated_at BEFORE UPDATE ON lab_courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
