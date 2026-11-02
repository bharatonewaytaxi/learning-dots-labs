# Tenant Subscription Suspension Flow

## Overview

This document explains how the Labs app handles tenant subscription suspension and reactivation.

## Automatic Suspension Flow

### Trigger: Subscription Status Changes to Inactive

```
User/Billing System updates tenant:
  UPDATE lab_tenants 
  SET subscription_status = 'suspended' 
  WHERE id = 'tenant-123';

          ↓

Database Trigger Fires:
  handle_tenant_subscription_change()

          ↓

Function Executes:
  suspend_tenant_labs('tenant-123')

          ↓

For each workspace in tenant:
  1. Find all active labs (provisioning, ready, stopped)
  2. For each lab:
     - Store current status in usage.previous_status
     - Set status = 'suspended'
     - Set usage.suspended_at = NOW()
     - Set usage.suspension_reason = 'tenant_subscription_inactive'
     - Call stopLab(external_ref) to stop VM/container

          ↓

Result:
  ✅ All labs suspended
  ✅ Running VMs stopped
  ✅ Previous state preserved
  ✅ New lab creation blocked
```

## Automatic Reactivation Flow

### Trigger: Subscription Status Returns to Active

```
User/Billing System updates tenant:
  UPDATE lab_tenants 
  SET subscription_status = 'active' 
  WHERE id = 'tenant-123';

          ↓

Database Trigger Fires:
  handle_tenant_subscription_change()

          ↓

Function Executes:
  reactivate_tenant_labs('tenant-123')

          ↓

For each workspace in tenant:
  1. Find all suspended labs
  2. For each lab:
     - Read usage.previous_status
     - Restore status to previous_status
       (provisioning → stopped, ready → ready, stopped → stopped)
     - Set usage.reactivated_at = NOW()
     - If restored to 'ready': call startLab(external_ref)

          ↓

Result:
  ✅ Labs restored to previous state
  ✅ Ready labs restarted
  ✅ New lab creation allowed
```

## Manual Control via API

### Suspend Tenant Labs

```bash
POST /api/labs/suspend-tenant
Body: { "tenantId": "tenant-123" }

Flow:
  1. Get all workspaces for tenant
  2. Get all active labs in those workspaces
  3. For each lab:
     - Store previous_status in usage metadata
     - Update status to 'suspended'
     - If status was 'ready', call stopLab()
  4. Return count of suspended labs

Response:
  {
    "success": true,
    "message": "Suspended 15 lab(s) for tenant",
    "tenantId": "tenant-123",
    "suspended": 15,
    "workspaces": 3
  }
```

### Reactivate Tenant Labs

```bash
POST /api/labs/reactivate-tenant
Body: { "tenantId": "tenant-123" }

Flow:
  1. Get all workspaces for tenant
  2. Get all suspended labs in those workspaces
  3. For each lab:
     - Read usage.previous_status
     - Restore to previous status (or 'stopped' as fallback)
     - If restoring to 'ready', call startLab()
  4. Return count of reactivated labs

Response:
  {
    "success": true,
    "message": "Reactivated 15 lab(s) for tenant",
    "tenantId": "tenant-123",
    "reactivated": 15,
    "workspaces": 3
  }
```

## Lab Creation Blocking

### When Subscription is Inactive

```bash
POST /api/labs/create
Body: {
  "workspaceId": "workspace-456",
  "userId": "learner-001",
  "courseId": "k8s-fundamentals"
}

Flow:
  1. Fetch workspace with tenant info
  2. Check tenant.subscription_status
  3. If not 'active', return error immediately

Response (403 Forbidden):
  {
    "error": "Tenant subscription is not active",
    "subscription_status": "suspended",
    "message": "Cannot create new labs while tenant subscription is suspended or inactive"
  }
```

### When Subscription is Active

```bash
Same request as above

Flow:
  1. Fetch workspace with tenant info
  2. Check tenant.subscription_status == 'active' ✓
  3. Continue with normal lab creation
  4. Provision lab asynchronously

Response (200 OK):
  {
    "success": true,
    "resource": {
      "id": "resource-789",
      "status": "provisioning",
      "message": "Lab is being provisioned"
    }
  }
```

## Status Transitions

### Normal Lab Lifecycle
```
provisioning → ready → stopped → deleted
              ↓
         (can restart)
```

### With Suspension
```
                    Tenant suspended
                           ↓
provisioning → ready → stopped → suspended
              ↓                       ↓
         (blocked)         Tenant reactivated
                                     ↓
                           ready or stopped
```

### Status Restoration Logic

When reactivating:
- `provisioning` → `stopped` (don't try to resume provisioning)
- `ready` → `ready` (and call startLab())
- `stopped` → `stopped` (leave stopped)
- Unknown → `stopped` (safe default)

## Database Schema

### lab_tenants Table

```sql
CREATE TABLE lab_tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  subscription_status TEXT NOT NULL DEFAULT 'active',  -- NEW in migration 024
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- status: operational status (active, suspended, expired)
-- subscription_status: billing status (active, suspended, cancelled, expired)
```

### lab_workspace_resources Usage Field

```json
{
  "created_via": "api",
  "lab_config": {...},
  "connection_info": {...},
  "provisioned_at": "2026-11-02T19:00:00Z",
  
  // Added on suspension:
  "suspended_at": "2026-11-02T20:00:00Z",
  "previous_status": "ready",
  "suspension_reason": "tenant_subscription_inactive",
  
  // Added on reactivation:
  "reactivated_at": "2026-11-02T21:00:00Z"
}
```

## Frontend Display

### Lab Card (index.html)

```html
<div class="lab-card">
  <h3>Kubernetes Training Q4</h3>
  <span class="lab-status status-suspended">suspended</span>
  <div class="lab-info">Course: k8s-fundamentals</div>
  <div class="lab-info">Lab ID: lab-abc123</div>
  <div class="lab-actions">
    <div style="font-size: 12px; color: #666;">
      Suspended - Tenant subscription inactive
    </div>
  </div>
</div>
```

### Admin Dashboard (admin.html)

```html
<tr>
  <td><strong>Kubernetes Training Q4</strong></td>
  <td>
    Test Academy 
    <span class="badge badge-pro">pro</span>
    <span class="badge badge-suspended">⚠️ suspended</span>
  </td>
  <td>k8s-fundamentals</td>
  <td><span class="badge badge-active">active</span></td>
  <td>0 ready / 15 total (15 suspended)</td>
  <td>Nov 1, 2026</td>
  <td><button>View Details</button></td>
</tr>
```

### Workspace Details Stats

```
Summary:
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 25           │ │ 1            │ │ 24           │ │ 0            │ │ 15           │
│ Active       │ │ Trainers     │ │ Learners     │ │ Active Labs  │ │ Suspended    │
│ Members      │ │              │ │              │ │              │ │ Labs         │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## Integration with Billing System

### Option 1: Direct Database Update (Recommended)

Your billing system can update `subscription_status` directly:

```sql
-- When payment fails or subscription cancelled:
UPDATE lab_tenants 
SET subscription_status = 'suspended' 
WHERE stripe_customer_id = 'cus_abc123';

-- Trigger fires automatically, labs are suspended

-- When payment resumes:
UPDATE lab_tenants 
SET subscription_status = 'active' 
WHERE stripe_customer_id = 'cus_abc123';

-- Trigger fires automatically, labs are reactivated
```

### Option 2: API Webhook

Your billing system calls Labs API endpoints:

```javascript
// Stripe webhook handler example
app.post('/webhooks/stripe', async (req, res) => {
  const event = req.body;
  
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;
    const tenantId = subscription.metadata.tenant_id;
    
    if (subscription.status === 'past_due' || subscription.status === 'canceled') {
      // Suspend labs via API
      await fetch('https://labs.example.com/api/labs/suspend-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId })
      });
      
      // Also update database
      await supabase
        .from('lab_tenants')
        .update({ subscription_status: 'suspended' })
        .eq('id', tenantId);
    }
    
    if (subscription.status === 'active') {
      // Reactivate labs via API
      await fetch('https://labs.example.com/api/labs/reactivate-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId })
      });
      
      // Also update database
      await supabase
        .from('lab_tenants')
        .update({ subscription_status: 'active' })
        .eq('id', tenantId);
    }
  }
  
  res.json({ received: true });
});
```

## Testing Scenarios

### Scenario 1: Payment Failure During Active Lab Session

```
1. Learner has active lab (status: ready)
2. Payment fails → subscription_status → 'suspended'
3. Database trigger fires
4. Lab status → 'suspended', VM stopped
5. Learner sees suspension message
6. Learner cannot start lab or create new labs
7. Payment resumes → subscription_status → 'active'
8. Database trigger fires
9. Lab status → 'ready', VM restarted
10. Learner can use lab again
```

### Scenario 2: Subscription Expires Between Sessions

```
1. Learner stops lab (status: stopped)
2. Subscription expires → subscription_status → 'expired'
3. Database trigger fires
4. Lab status → 'suspended'
5. Learner tries to start lab → blocked by UI (suspended)
6. Learner tries to create new lab → API returns 403 error
7. Subscription renewed → subscription_status → 'active'
8. Database trigger fires
9. Lab status → 'stopped' (restored from previous)
10. Learner can start lab or create new labs
```

### Scenario 3: Tenant Admin Voluntary Pause

```
1. Admin wants to pause all labs for maintenance
2. Admin (or API) updates: subscription_status → 'suspended'
3. All tenant labs suspended, VMs stopped
4. Saves infrastructure costs during pause
5. When ready: subscription_status → 'active'
6. All labs restored to previous state
```

## Performance Considerations

### Suspension Performance
- **Asynchronous**: Lab stopping happens in background (non-blocking)
- **Batch updates**: Database updates are batched per workspace
- **Graceful**: Labs marked suspended immediately, actual VM stops happen async

### Reactivation Performance
- **Asynchronous**: Lab starting happens in background
- **Staggered**: Can implement delays between starts if needed
- **Fallback**: Labs default to 'stopped' if previous state unknown (safe)

## Error Handling

### Suspension Errors
- If `stopLab()` fails: Lab marked suspended anyway, error logged
- If database update fails: Transaction rolls back, trigger retries on next update

### Reactivation Errors
- If `startLab()` fails: Lab marked 'stopped' instead of 'ready', error logged
- If database update fails: Transaction rolls back, manual reactivation needed

### Creation Blocking Errors
- Clear error message returned to user
- Frontend displays subscription status
- Admin receives notification (if configured)

## Monitoring Recommendations

Monitor these metrics:
- Count of suspended labs per tenant
- Failed suspension/reactivation attempts
- Blocked lab creation attempts (indicates subscription issues)
- Time to suspend all labs (should be < 30 seconds)
- Time to reactivate all labs (depends on provisioning)

## Support Scenarios

### User Reports "Cannot Create Lab"

1. Check tenant `subscription_status` in database
2. If not 'active', verify with billing system
3. If billing is fine but status wrong, manually update:
   ```sql
   UPDATE lab_tenants 
   SET subscription_status = 'active' 
   WHERE id = 'tenant-id';
   ```
4. Labs will automatically reactivate via trigger

### User Reports "Lab is Suspended"

1. Check tenant `subscription_status`
2. Check lab `usage.suspension_reason`
3. Verify billing status
4. If false positive, manually reactivate:
   ```bash
   curl -X POST https://labs.example.com/api/labs/reactivate-tenant \
     -H "Content-Type: application/json" \
     -d '{"tenantId": "tenant-id"}'
   ```

## Security Notes

✅ **Service role only**: Suspension operations use `supabaseAdmin` (never exposed to browser)
✅ **RLS respected**: Users can only see their tenant's suspension status
✅ **Audit trail**: All suspension/reactivation events logged in `usage` JSON
✅ **Graceful degradation**: Failed stops don't block suspension marking
✅ **No data loss**: All lab state preserved during suspension

## Future Enhancements

Possible improvements:
- Email notifications on suspension/reactivation
- Grace period before suspension (e.g., 3 days past due)
- Partial suspension (limit to X active labs instead of 0)
- Suspension scheduling (e.g., suspend after business hours)
- Cost savings dashboard (show savings during suspension)
- Automatic cleanup of long-suspended labs (e.g., > 90 days)
