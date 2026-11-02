# Quick Start Testing Guide

## Prerequisites
- Supabase project configured at db-api.thelearningdots.com
- Node.js 18+ installed
- Git repository cloned

## 5-Minute Setup

### 1. Apply Database Migration (2 min)
```bash
# Via Supabase Dashboard:
# 1. Go to SQL Editor
# 2. Copy contents of: supabase/migrations/20261102000000_lab_tenancy_model.sql
# 3. Run the migration
# 4. Verify tables created: lab_tenants, lab_workspaces, lab_workspace_resources, etc.
```

### 2. Create Test Data (1 min)
```sql
-- Run in Supabase SQL Editor:

-- 1. Create tenant
INSERT INTO lab_tenants (name, slug, plan, starts_on, status)
VALUES ('Test Academy', 'test-academy', 'pro', CURRENT_DATE, 'active')
RETURNING id;
-- Copy the returned ID

-- 2. Create workspace (replace TENANT_ID)
INSERT INTO lab_workspaces (tenant_id, name, course_id, status, start_date, end_date)
VALUES 
  ('TENANT_ID_HERE', 'Kubernetes Training Q4', 'k8s-fundamentals', 'active', CURRENT_DATE, CURRENT_DATE + 30)
RETURNING id;
-- Copy the returned ID

-- 3. Add members (replace WORKSPACE_ID)
INSERT INTO lab_workspace_members (workspace_id, user_id, email, name, role, status)
VALUES
  ('WORKSPACE_ID_HERE', 'trainer-001', 'trainer@test.com', 'John Trainer', 'trainer', 'active'),
  ('WORKSPACE_ID_HERE', 'learner-001', 'alice@test.com', 'Alice Student', 'learner', 'active'),
  ('WORKSPACE_ID_HERE', 'learner-002', 'bob@test.com', 'Bob Student', 'learner', 'active');
```

### 3. Configure & Run (2 min)
```bash
# Clone and setup
git clone https://github.com/bharatonewaytaxi/learning-dots-labs.git
cd learning-dots-labs
git checkout cursor/labs-tenancy-integration-fad7

# Install
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your Supabase credentials:
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_ANON_KEY=eyJ...
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Run
npm run dev
# Server starts on http://localhost:3000
```

## Testing Scenarios

### ✅ Test 1: Request a Lab (30 seconds)
1. Open http://localhost:3000
2. Select "Kubernetes Training Q4" workspace
3. Select "Kubernetes Fundamentals" course
4. Click "Request Lab"
5. **Expected**: Lab card appears with "provisioning" status
6. **Wait 2 seconds**: Status updates to "ready"
7. **Verify**: Lab shows workspace name, course, external_ref (lab-xxxxx), expiration date

### ✅ Test 2: View Admin Dashboard (30 seconds)
1. Open http://localhost:3000/admin
2. **Expected**: See workspace "Kubernetes Training Q4" in list
3. **Verify**: Shows "1 ready / 1 total" labs (or appropriate count)
4. Click "View Details"
5. **Expected**: See all 3 members (John, Alice, Bob)
6. **Verify**: Shows lab count per member (Alice should show 1 lab)
7. **Verify**: Member cards show role badges (trainer/learner)

### ✅ Test 3: Lab Lifecycle (1 minute)
1. From main page (http://localhost:3000), find your ready lab
2. Click "Stop" button
3. **Expected**: Status changes to "stopped", button changes to "Start"
4. Click "Start" button
5. **Expected**: Status returns to "ready"
6. Click "Delete" button, confirm
7. **Expected**: Lab disappears or shows "deleted"
8. **Refresh admin page**: Lab count should decrease

### ✅ Test 4: Workspace Cleanup (30 seconds)
```bash
# In terminal:
curl -X POST http://localhost:3000/api/labs/cleanup-workspace \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "YOUR_WORKSPACE_ID"}'

# Expected response:
# {"success":true,"message":"Cleaned up X lab(s)","workspace":"..."}
```

Check admin dashboard - all labs should show "expired"

### ✅ Test 5: API Direct Test (30 seconds)
```bash
# Create lab via API:
curl -X POST http://localhost:3000/api/labs/create \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "userId": "learner-002",
    "courseId": "docker-basics"
  }'

# Expected response:
# {"success":true,"resource":{"id":"...","status":"provisioning","message":"Lab is being provisioned"}}

# Check status after 2 seconds:
curl http://localhost:3000/api/labs/user/learner-002

# Should show lab with status "ready"
```

## Verification Checklist

After testing, verify in Supabase SQL Editor:

```sql
-- Check all resources
SELECT 
  r.id,
  r.status,
  r.external_ref,
  w.name as workspace_name,
  m.name as user_name,
  r.created_at
FROM lab_workspace_resources r
JOIN lab_workspaces w ON w.id = r.workspace_id
JOIN lab_workspace_members m ON m.workspace_id = r.workspace_id AND m.user_id = r.user_id
ORDER BY r.created_at DESC;

-- Check resource counts by status
SELECT status, COUNT(*) 
FROM lab_workspace_resources 
WHERE deleted_at IS NULL
GROUP BY status;
```

## Common Issues & Solutions

### Issue: "Failed to load workspaces"
**Solution**: Check Supabase credentials in .env, verify RLS policies allow read access

### Issue: "User is not a member of this workspace"
**Solution**: Verify user_id in lab_workspace_members matches the userId in API call

### Issue: Labs not updating to "ready"
**Solution**: Check browser console, verify server logs, confirm mock provisioning isn't throwing errors

### Issue: Admin page shows 0 labs but labs exist
**Solution**: Check that workspace.status is 'active', verify resource.deleted_at is NULL

## Success Criteria

✅ Database migration applied without errors
✅ Test data created (tenant, workspace, members)
✅ Application runs on http://localhost:3000
✅ Can request labs from main interface
✅ Labs show correct status progression (provisioning → ready)
✅ Admin dashboard displays workspaces and member stats
✅ Can view lab seats per workspace member
✅ Lab lifecycle operations work (stop, start, delete)
✅ Workspace cleanup marks all labs as expired
✅ Docker image builds successfully

## Production Deployment Checklist

Before deploying to production:

- [ ] Apply migration to production Supabase
- [ ] Set production environment variables (service role key!)
- [ ] Replace mock lab provisioning with real provider integration
- [ ] Integrate authentication system (replace mock user IDs)
- [ ] Test with real workspaces and users
- [ ] Configure scheduled cleanup job for expired labs
- [ ] Set up monitoring and alerting
- [ ] Review and test RLS policies
- [ ] Load test API endpoints
- [ ] Document lab provider integration

## Architecture Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│  ┌──────────────────┐              ┌──────────────────┐     │
│  │  index.html      │              │  admin.html      │     │
│  │  labs.js         │              │  admin.js        │     │
│  │  (anon key)      │              │  (anon key)      │     │
│  └─────────┬────────┘              └─────────┬────────┘     │
└────────────┼────────────────────────────────┼──────────────┘
             │                                 │
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express.js Server                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  /api/labs/*          (labs.js)                      │   │
│  │  - create, teardown, cleanup, status updates         │   │
│  │  - Uses supabaseAdmin (SERVICE ROLE) ✓              │   │
│  │                                                       │   │
│  │  /api/admin/*         (admin.js)                     │   │
│  │  - workspaces, courses, stats, tenants               │   │
│  │  - Uses supabaseAdmin (SERVICE ROLE) ✓              │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────┬──────────────────────────────────┬─────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────┐         ┌──────────────────────────┐
│  Lab Provider API      │         │  Supabase Database       │
│  (Kubernetes/Cloud)    │         │  - lab_tenants           │
│  - provisionLab()      │         │  - lab_workspaces        │
│  - teardownLab()       │         │  - lab_workspace_members │
│  - Mock in demo ⚠️     │         │  - lab_workspace_resources│
└────────────────────────┘         │  - lab_courses           │
                                    │  - RLS enabled ✓         │
                                    └──────────────────────────┘
```

## Key Security Points

1. ✅ **Service role never sent to browser** - Only used in backend API
2. ✅ **RLS policies limit tenant access** - Users only see their tenant's data
3. ✅ **Validation before resource creation** - Workspace & member checks
4. ✅ **All lab operations server-side** - No direct database access from frontend
5. ✅ **Proper error handling** - No sensitive data in error messages

## Next Steps After Testing

1. Review PR: https://github.com/bharatonewaytaxi/learning-dots-labs/pull/1
2. Test locally using this guide
3. Merge PR to trigger Docker build (ghcr.io/bharatonewaytaxi/labs:latest)
4. Deploy container to production
5. Integrate real lab provider
6. Add authentication integration
7. Monitor and iterate
