# Labs Tenancy Integration Guide

## Overview

This integration adds workspace-based lab tracking to the existing Labs app, recording all lab resources in the Supabase database with tenant isolation and automatic suspension when subscriptions are inactive.

## What's Included

### 1. Database Migration (025_labs_suspension.sql)
- Adds `subscription_status` field to `lab_tenants` (if not exists)
- Creates `suspend_tenant_labs()` function
- Creates `reactivate_tenant_labs()` function
- Creates `is_tenant_subscription_active()` helper function
- Database trigger for automatic suspension on subscription changes
- **NOTE**: Do not apply this migration yourself. It's idempotent and will be applied by the LMS team.

### 2. Supabase Edge Functions
- **record-lab**: Records lab creation in `lab_workspace_resources` with subscription check
- **cleanup-workspace**: Marks workspace labs as expired when workspace closes
- **cleanup-member**: Marks member labs as revoked when member removed

### 3. Admin Dashboard (`admin.html`, `admin.js`)
- View all workspaces with subscription status
- Shows lab seat counts per workspace
- View members and their assigned labs
- Displays suspension warnings

### 4. User Labs View (`index.html`, `labs.js`)
- Shows user's active labs across workspaces
- Displays suspension status
- Links to lab connection URL

## Integration Steps

### Step 1: Deploy Edge Functions

```bash
# Deploy to your Supabase project
cd supabase/functions

supabase functions deploy record-lab
supabase functions deploy cleanup-workspace
supabase functions deploy cleanup-member
```

### Step 2: Wire Lab Launch Flow

When your existing lab launch code provisions a VM, call the `record-lab` edge function:

```javascript
// In your existing lab launch code, after VM is provisioned:
async function onLabProvisioned(vmId, vmUrl, vmCredentials) {
    const { data, error } = await supabase.functions.invoke('record-lab', {
        body: {
            workspaceId: currentWorkspace.id,
            userId: currentUser.id,
            labId: vmId,  // The VM/container ID from your provisioning system
            status: 'ready',
            usage: {
                connection_info: {
                    url: vmUrl,
                    credentials: vmCredentials
                },
                provisioned_at: new Date().toISOString()
            },
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }
    })

    if (error) {
        console.error('Failed to record lab:', error)
        // Handle error - maybe retry or alert user
    }
}
```

### Step 3: Hook Workspace Cleanup

When a workspace is closed or reaches end date:

```javascript
async function onWorkspaceClosed(workspaceId) {
    const { data, error } = await supabase.functions.invoke('cleanup-workspace', {
        body: { workspaceId }
    })

    if (error) {
        console.error('Failed to cleanup workspace labs:', error)
    } else {
        console.log(`Marked ${data.resources.length} labs for cleanup`)
        // Now tear down the actual VMs using your existing teardown code
        for (const resource of data.resources) {
            await teardownVM(resource.external_ref)
        }
    }
}
```

### Step 4: Hook Member Removal

When a member is removed from a workspace:

```javascript
async function onMemberRemoved(workspaceId, userId) {
    const { data, error } = await supabase.functions.invoke('cleanup-member', {
        body: { workspaceId, userId }
    })

    if (error) {
        console.error('Failed to cleanup member labs:', error)
    } else {
        console.log(`Marked ${data.resources.length} labs for cleanup`)
        // Now tear down the actual VMs
        for (const resource of data.resources) {
            await teardownVM(resource.external_ref)
        }
    }
}
```

### Step 5: Configure Supabase in Frontend

Add to your HTML or initialize script:

```html
<script>
    // Set these globally before loading labs.js or admin.js
    window.SUPABASE_URL = 'https://tgngznnwioxpnvhbaoxh.supabase.co'
    window.SUPABASE_ANON_KEY = 'your-anon-key-here'
</script>
```

Or use environment variables at build time.

### Step 6: Read Courses from Database

Update your course selection to read from `lab_courses` table:

```javascript
async function loadCourses() {
    const { data: courses, error } = await supabase
        .from('lab_courses')
        .select('*')
        .eq('active', true)
        .order('name')

    if (error) {
        console.error('Failed to load courses:', error)
        return []
    }

    return courses
}
```

## Subscription Suspension

The database trigger automatically handles suspension:

```javascript
// When a billing webhook or admin action updates subscription status:
const { error } = await supabase
    .from('lab_tenants')
    .update({ subscription_status: 'suspended' })
    .eq('id', tenantId)

// Trigger fires automatically:
// 1. Calls suspend_tenant_labs(tenantId)
// 2. All labs marked 'suspended'
// 3. Previous status stored in usage.previous_status

// When subscription restored:
const { error } = await supabase
    .from('lab_tenants')
    .update({ subscription_status: 'active' })
    .eq('id', tenantId)

// Trigger fires automatically:
// 1. Calls reactivate_tenant_labs(tenantId)
// 2. Labs restored to previous status
```

## Checking Subscription Before Lab Creation

The `record-lab` function already checks subscription status, but you can also check in your UI:

```javascript
async function checkSubscription(workspaceId) {
    const { data: workspace, error } = await supabase
        .from('lab_workspaces')
        .select('tenant:lab_tenants(subscription_status)')
        .eq('id', workspaceId)
        .single()

    if (error) return false

    return workspace.tenant?.subscription_status === 'active'
}

// Before showing "Launch Lab" button:
const canLaunch = await checkSubscription(workspaceId)
if (!canLaunch) {
    showMessage('Subscription is inactive. Cannot launch labs.')
    disableLaunchButton()
}
```

## Testing

### Test Lab Recording

1. Launch a lab through your existing flow
2. Check `lab_workspace_resources` table:
   ```sql
   SELECT * FROM lab_workspace_resources 
   WHERE user_id = 'your-user-id' 
   ORDER BY created_at DESC LIMIT 1;
   ```
3. Verify fields: `external_ref` (VM ID), `status` ('ready'), `usage` (connection info)

### Test Suspension

1. Update tenant subscription:
   ```sql
   UPDATE lab_tenants 
   SET subscription_status = 'suspended' 
   WHERE id = 'tenant-id';
   ```

2. Check labs are suspended:
   ```sql
   SELECT id, status, usage->>'suspended_at', usage->>'previous_status'
   FROM lab_workspace_resources
   WHERE workspace_id IN (
       SELECT id FROM lab_workspaces WHERE tenant_id = 'tenant-id'
   );
   ```

3. Reactivate:
   ```sql
   UPDATE lab_tenants 
   SET subscription_status = 'active' 
   WHERE id = 'tenant-id';
   ```

4. Verify labs restored

### Test Admin Dashboard

1. Navigate to `/admin.html`
2. Should see all workspaces with lab counts
3. Click "View" on a workspace
4. Should see members with their lab assignments

## Security Notes

- Edge functions use `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
- Frontend uses anon key (already has RLS)
- `suspend_tenant_labs` and `reactivate_tenant_labs` are SECURITY DEFINER (server-side execution)
- Trainers can view their workspace data via existing RLS policies

## File Structure

```
├── supabase/
│   ├── functions/
│   │   ├── record-lab/index.ts
│   │   ├── cleanup-workspace/index.ts
│   │   └── cleanup-member/index.ts
│   └── migrations/
│       └── 20261102_025_labs_suspension.sql
├── public/
│   ├── index.html
│   ├── labs.js
│   ├── admin.html
│   └── admin.js
├── Dockerfile
└── INTEGRATION.md
```

## Deployment

The existing GitHub Actions workflow will build and push the Docker image to `ghcr.io/bharatonewaytaxi/labs:latest` when merged to main.

## Support

For issues:
- Check browser console for errors
- Verify Supabase configuration (URL, anon key)
- Check edge function logs in Supabase dashboard
- Verify user is authenticated (`supabase.auth.getUser()`)
