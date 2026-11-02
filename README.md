# Learning Dots Labs - Tenancy Integration

Integration layer for workspace-based lab tracking in the Learning Dots Labs platform. This adds database persistence, tenant isolation, and automatic subscription suspension to the existing Labs app.

## Overview

This integration adds:
- Lab resource tracking in `lab_workspace_resources` table
- Automatic subscription suspension when tenant subscription becomes inactive
- Admin dashboard showing lab seats per workspace
- Course master list integration from database
- Workspace and member cleanup hooks

## Architecture

- **Static Files**: Served via nginx (existing deployment model)
- **Database**: Supabase with RLS (tables already exist from LMS migrations 023/024)
- **Server-Side**: Supabase Edge Functions for service-role operations
- **Frontend**: Vanilla JS with Supabase JS client

## Key Components

### Migration 025 (`supabase/migrations/20261102_025_labs_suspension.sql`)
- Adds `subscription_status` to `lab_tenants` (if not exists)
- Creates suspension/reactivation functions
- Database trigger for automatic suspension
- **Idempotent** - safe to run multiple times
- **Not applied by this PR** - will be applied by LMS team

### Supabase Edge Functions

**record-lab**: Records lab creation with subscription check
```typescript
POST /functions/v1/record-lab
Body: {
  workspaceId: string,
  userId: string,
  labId: string,  // VM ID
  status: 'ready' | 'provisioning',
  usage: { connection_info, ... },
  expiresAt: string
}
```

**cleanup-workspace**: Marks all workspace labs as expired
```typescript
POST /functions/v1/cleanup-workspace
Body: { workspaceId: string }
```

**cleanup-member**: Marks member labs as revoked
```typescript
POST /functions/v1/cleanup-member
Body: { workspaceId: string, userId: string }
```

### Admin Dashboard (`admin.html`)
- View all workspaces with lab counts
- Filter by tenant subscription status
- View members and their lab assignments
- Shows suspension warnings

### User Labs View (`index.html`)
- Shows user's active labs
- Displays connection URLs
- Shows suspension status

## Integration Points

### 1. Lab Launch
Call `record-lab` edge function after provisioning:
```javascript
await supabase.functions.invoke('record-lab', {
  body: {
    workspaceId,
    userId,
    labId: vmId,
    status: 'ready',
    usage: { connection_info: { url, credentials } },
    expiresAt
  }
})
```

### 2. Workspace Closure
Call `cleanup-workspace` then teardown VMs:
```javascript
const { data } = await supabase.functions.invoke('cleanup-workspace', {
  body: { workspaceId }
})

for (const resource of data.resources) {
  await teardownVM(resource.external_ref)
}
```

### 3. Member Removal
Call `cleanup-member` then teardown VMs:
```javascript
const { data } = await supabase.functions.invoke('cleanup-member', {
  body: { workspaceId, userId }
})

for (const resource of data.resources) {
  await teardownVM(resource.external_ref)
}
```

### 4. Subscription Management
Update tenant subscription_status directly (trigger handles suspension):
```javascript
await supabase
  .from('lab_tenants')
  .update({ subscription_status: 'suspended' })
  .eq('id', tenantId)
// Database trigger automatically suspends all tenant labs
```

## Deployment

1. Deploy edge functions:
   ```bash
   supabase functions deploy record-lab
   supabase functions deploy cleanup-workspace
   supabase functions deploy cleanup-member
   ```

2. Configure Supabase in frontend:
   ```html
   <script>
     window.SUPABASE_URL = 'https://your-project.supabase.co'
     window.SUPABASE_ANON_KEY = 'your-anon-key'
   </script>
   ```

3. Merge to main - GitHub Actions builds Docker image automatically

## File Structure

```
├── supabase/
│   ├── functions/          # Edge functions for server-side operations
│   │   ├── record-lab/
│   │   ├── cleanup-workspace/
│   │   └── cleanup-member/
│   └── migrations/
│       └── 20261102_025_labs_suspension.sql
├── public/                 # Static files served by nginx
│   ├── index.html         # User labs view
│   ├── labs.js
│   ├── admin.html         # Admin dashboard
│   └── admin.js
├── Dockerfile             # nginx-based container
└── INTEGRATION.md         # Detailed integration guide
```

## Security

- ✅ Edge functions use service role key (server-side)
- ✅ Frontend uses anon key with RLS
- ✅ Suspension functions are SECURITY DEFINER
- ✅ Subscription check before lab creation
- ✅ Trainers have read access via existing RLS policies

## Testing

See [INTEGRATION.md](./INTEGRATION.md) for detailed testing steps.

Quick test:
```sql
-- Suspend tenant
UPDATE lab_tenants SET subscription_status = 'suspended' WHERE id = 'tenant-id';

-- Check labs suspended
SELECT status, usage->>'previous_status' FROM lab_workspace_resources
WHERE workspace_id IN (SELECT id FROM lab_workspaces WHERE tenant_id = 'tenant-id');

-- Reactivate
UPDATE lab_tenants SET subscription_status = 'active' WHERE id = 'tenant-id';
```

## Database Schema

Tables (already exist from LMS migrations 023/024):
- `lab_tenants` - Organizations with subscription_status
- `lab_workspaces` - Training workspaces
- `lab_workspace_members` - Workspace members (trainer/learner/observer)
- `lab_workspace_resources` - Lab tracking (added by this integration)
- `lab_courses` - Master course list

## License

MIT
