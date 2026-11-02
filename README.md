# Learning Dots Labs

A workspace-based lab management system integrated with the Learning Dots shared tenancy model.

## Overview

Learning Dots Labs provides a comprehensive platform for managing virtual labs within educational workspaces. The system integrates with the Supabase database tenancy model to provide:

- **Multi-tenant workspace management**: Each tenant can have multiple workspaces with assigned trainers and learners
- **Lab resource tracking**: All lab assignments and resources are tracked in `lab_workspace_resources` 
- **Automatic lifecycle management**: Labs are provisioned, tracked, and torn down based on workspace and member status
- **Course integration**: Labs are mapped to courses from the database master course list
- **Admin dashboard**: View workspace statistics, lab seats, and member details

## Architecture

### Database Schema

The application uses the following tables (created by migrations 023 and 024):

- `lab_tenants`: Organizations/companies with plans (free, pro, enterprise) and subscription_status
- `lab_tenant_users`: Tenant members (users belonging to tenants)
- `lab_user_roles`: User roles within tenants (tenantadmin, member)
- `lab_workspaces`: Training workspaces with assigned trainers and courses
- `lab_workspace_members`: Workspace members (trainer, learner, observer)
- `lab_workspace_resources`: Lab resources assigned to learners (with suspension support)
- `lab_courses`: Master course definitions with lab templates

**Migration 024 additions**:
- `subscription_status` field on lab_tenants (active, suspended, cancelled, expired)
- Database functions for tenant suspension/reactivation
- Automatic trigger on subscription status changes
- Enhanced RLS policies for trainer access to their workspace members and labs

### Key Features

1. **Lab Creation**: When a learner requests a lab in a workspace, a record is created in `lab_workspace_resources` with:
   - `kind`: 'lab'
   - `external_ref`: VM/lab ID from provisioning system
   - `status`: provisioning → ready → stopped → suspended → expired/deleted
   - `usage`: JSON tracking connection info, timestamps, metrics
   - `expires_at`: Automatic expiration date

2. **Status Tracking**: Lab status is updated through the lifecycle:
   - `provisioning`: Lab is being created
   - `ready`: Lab is available for use
   - `stopped`: Lab is temporarily stopped
   - `suspended`: Tenant subscription inactive (automatically managed)
   - `failed`: Provisioning failed
   - `expired`: Workspace ended
   - `deleted`: Torn down and removed

3. **Tenant Subscription Management** (NEW):
   - When tenant `subscription_status` becomes inactive: all labs automatically suspended and stopped
   - New lab creation blocked while subscription is inactive
   - When subscription reactivated: suspended labs restored to previous state
   - Database trigger handles suspension/reactivation automatically
   - Manual API endpoints available for forced suspension/reactivation

4. **Automatic Cleanup**:
   - When a workspace is closed or end date passed: all labs marked expired and torn down
   - When a member is removed: their labs are revoked and torn down
   - Service role is used for all resource operations (never exposed to browser)

5. **Admin Dashboard**: Shows:
   - Workspace overview with lab counts (including suspended)
   - Per-workspace member lists with lab seat assignments
   - Real-time status of all labs
   - Filtering by tenant
   - Subscription status warnings

6. **Trainer Access** (Migration 024):
   - Trainers can view their assigned workspace members
   - Trainers can view labs of learners in their workspaces
   - RLS policies grant read access to trainers for their workspaces

## Setup

### Prerequisites

- Node.js 18+
- Supabase project at `db-api.thelearningdots.com`
- Docker (for containerized deployment)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/bharatonewaytaxi/learning-dots-labs.git
cd learning-dots-labs
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

Required environment variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anon key (for client-side operations)
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (for server-side lab operations)
- `PORT`: Server port (default: 3000)

4. Run database migrations:
```bash
# Apply the migration to your Supabase database
# The migration file is in: supabase/migrations/20261102000000_lab_tenancy_model.sql

# Using Supabase CLI:
supabase db push

# Or apply directly via Supabase Dashboard SQL Editor
```

5. Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## API Endpoints

### Labs API (`/api/labs`)

- `POST /api/labs/create` - Create a new lab for a learner in a workspace
  - Body: `{ workspaceId, userId, courseId?, labType? }`
  - Creates record in `lab_workspace_resources` with service role
  - Provisions lab asynchronously and updates status

- `GET /api/labs/workspace/:workspaceId` - Get all labs for a workspace
  - Returns all resources with member and workspace details

- `GET /api/labs/user/:userId` - Get all labs for a user
  - Returns user's labs across all workspaces

- `POST /api/labs/update-status` - Update lab status
  - Body: `{ resourceId, status, usage? }`
  - Updates status and optional usage metadata

- `POST /api/labs/teardown/:resourceId` - Teardown a specific lab
  - Marks for deletion and tears down via lab provider
  - Updates status to 'deleting' → 'deleted'

- `POST /api/labs/cleanup-workspace` - Clean up all labs in a workspace
  - Called when workspace ends or is closed
  - Marks all labs as expired and tears them down

- `POST /api/labs/cleanup-member` - Clean up labs for removed member
  - Called when member is removed from workspace
  - Marks their labs as revoked and tears them down

- `POST /api/labs/suspend-tenant` - Suspend all labs for a tenant (NEW)
  - Body: `{ tenantId }`
  - Stops all running labs and marks as 'suspended'
  - Stores previous status for later restoration
  - Typically called when subscription becomes inactive

- `POST /api/labs/reactivate-tenant` - Reactivate suspended labs (NEW)
  - Body: `{ tenantId }`
  - Restores labs to previous status (ready/stopped)
  - Restarts labs that were previously ready
  - Called when subscription becomes active again

**Note**: Lab creation automatically checks tenant `subscription_status` and blocks creation if not 'active'.

### Admin API (`/api/admin`)

- `GET /api/admin/courses` - Get all active courses from master list
- `GET /api/admin/workspaces` - List all workspaces with lab counts
  - Query param: `tenantId` (optional) - filter by tenant
  - Query param: `trainerId` (optional) - filter by assigned trainer
- `GET /api/admin/workspace/:workspaceId/stats` - Detailed workspace stats
  - Returns members with their lab seat assignments
  - Respects trainer access (trainers can view their workspace stats)
- `GET /api/admin/tenants` - List all tenants
- `GET /api/admin/resources/stats` - Overall resource statistics
  - Query params: `tenantId`, `workspaceId` (optional filters)

## Testing

### Manual Testing Steps

1. **Setup Test Data** (via Supabase SQL Editor):

```sql
-- Create a test tenant
INSERT INTO lab_tenants (name, slug, plan, starts_on, status)
VALUES ('Test Academy', 'test-academy', 'pro', CURRENT_DATE, 'active')
RETURNING id;

-- Create a test workspace (replace tenant_id with actual ID from above)
INSERT INTO lab_workspaces (tenant_id, name, description, course_id, status, start_date, end_date)
VALUES 
  ('TENANT_ID_HERE', 'Kubernetes Training Q4', 'K8s fundamentals course', 'k8s-fundamentals', 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
RETURNING id;

-- Add test members (replace workspace_id)
INSERT INTO lab_workspace_members (workspace_id, user_id, email, name, role, status)
VALUES
  ('WORKSPACE_ID_HERE', 'user-1', 'trainer@example.com', 'John Trainer', 'trainer', 'active'),
  ('WORKSPACE_ID_HERE', 'user-2', 'learner1@example.com', 'Alice Learner', 'learner', 'active'),
  ('WORKSPACE_ID_HERE', 'user-3', 'learner2@example.com', 'Bob Learner', 'learner', 'active');
```

2. **Test Lab Creation**:
   - Navigate to `http://localhost:3000`
   - Select the test workspace from dropdown
   - Select a course
   - Click "Request Lab"
   - Verify lab appears with "provisioning" status
   - After a few seconds, status should update to "ready"

3. **Test Admin Dashboard**:
   - Navigate to `http://localhost:3000/admin`
   - Verify workspace appears in list
   - Click "View Details" on the workspace
   - Verify member list shows with lab counts
   - Verify lab seats are displayed per member

4. **Test Lab Lifecycle**:
   - From main page, click "Stop" on a ready lab
   - Verify status changes to "stopped"
   - Click "Start" to restart
   - Verify status returns to "ready"
   - Click "Delete" to teardown
   - Verify lab is marked for deletion

5. **Test Workspace Cleanup**:
   - Use API to close workspace:
     ```bash
     curl -X POST http://localhost:3000/api/labs/cleanup-workspace \
       -H "Content-Type: application/json" \
       -d '{"workspaceId": "WORKSPACE_ID_HERE"}'
     ```
   - Verify all labs in workspace are marked "expired"

6. **Test Member Cleanup**:
   - Use API to remove member's labs:
     ```bash
     curl -X POST http://localhost:3000/api/labs/cleanup-member \
       -H "Content-Type: application/json" \
       -d '{"workspaceId": "WORKSPACE_ID_HERE", "userId": "user-2"}'
     ```
   - Verify member's labs are marked "revoked"

7. **Test Tenant Suspension** (NEW):
   - Suspend tenant and all labs:
     ```bash
     curl -X POST http://localhost:3000/api/labs/suspend-tenant \
       -H "Content-Type: application/json" \
       -d '{"tenantId": "TENANT_ID_HERE"}'
     ```
   - Verify all labs marked "suspended" in admin dashboard
   - Try to create new lab - should be blocked with error
   - Reactivate tenant:
     ```bash
     curl -X POST http://localhost:3000/api/labs/reactivate-tenant \
       -H "Content-Type: application/json" \
       -d '{"tenantId": "TENANT_ID_HERE"}'
     ```
   - Verify labs restored to previous status

8. **Test Database Trigger** (NEW):
   - Update tenant subscription_status via SQL:
     ```sql
     UPDATE lab_tenants 
     SET subscription_status = 'suspended' 
     WHERE id = 'TENANT_ID_HERE';
     ```
   - Check that labs are automatically suspended
   - Restore subscription:
     ```sql
     UPDATE lab_tenants 
     SET subscription_status = 'active' 
     WHERE id = 'TENANT_ID_HERE';
     ```
   - Check that labs are automatically reactivated

### Automated Testing

The application currently uses mock lab provisioning (simulates 1 second delay). To integrate with real lab infrastructure:

1. Replace the `provisionLab()` and `teardownLab()` functions in `api/labs.js`
2. Implement actual calls to your lab provisioning system (Kubernetes, cloud provider, etc.)
3. Update the connection info structure based on your lab provider's response

## Deployment

### Docker Deployment

The repository includes a Dockerfile and GitHub Actions workflow for building `ghcr.io/bharatonewaytaxi/labs:latest` on merge to main.

```bash
# Build locally
docker build -t learning-dots-labs .

# Run
docker run -p 3000:3000 \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_ANON_KEY=your-key \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-key \
  learning-dots-labs
```

### Automated CI/CD

The GitHub Actions workflow (`.github/workflows/docker-build.yml`) automatically:
- Builds on push to main
- Pushes to `ghcr.io/bharatonewaytaxi/labs:latest`
- No manual intervention required after merge

## Database Migration Notes

The migration files are:

1. **Migration 023** (`supabase/migrations/20261102000000_lab_tenancy_model.sql`):
   - Core lab tenancy tables
   - RLS policies for tenant isolation
   - Lab workspace and resource tracking
   - Course master list

2. **Migration 024** (`supabase/migrations/20261102000001_tenant_suspension_trainer_access.sql`):
   - `subscription_status` field on lab_tenants
   - Suspension/reactivation functions
   - Database trigger for automatic suspension
   - Enhanced RLS policies for trainer access

Both migrations are:
- **Additive only**: Safe to run on existing database
- **Idempotent**: Uses `IF NOT EXISTS` clauses
- **RLS enabled**: All tables have Row Level Security
- **Indexed**: Performance indexes on all foreign keys

To apply:
```bash
# Via Supabase CLI
supabase db push

# Or run the SQL directly in Supabase Dashboard (in order: 023 then 024)
```

## Security Notes

1. **Service Role Usage**: Lab resource operations use `supabaseAdmin` (service role) to bypass RLS
2. **Never expose service key**: Service key stays server-side only
3. **RLS Policies**: All tables have policies limiting users to their tenant's data
4. **Authentication**: Current implementation uses mock user IDs for demo; integrate with your auth system

## Backwards Compatibility

The application is designed to be backwards compatible:
- New tables don't affect existing tables
- RLS policies are scoped to lab_* tables only
- Existing applications can continue to operate independently
- Lab provisioning is isolated from other systems

## Course Management

Courses are now read from the database `lab_courses` table instead of being hard-coded. To add new courses:

```sql
INSERT INTO lab_courses (course_id, name, description, duration_hours, lab_templates, active)
VALUES (
  'new-course-id',
  'New Course Name',
  'Course description',
  40,
  '[{"name": "lab-config", "type": "vm"}]'::jsonb,
  true
);
```

## Future Enhancements

Potential improvements:
- Real-time lab status updates via Supabase Realtime
- Usage analytics and reporting
- Cost tracking per tenant/workspace
- Lab templates management UI
- Automated lab expiration cleanup job
- Integration with LMS for course sync
- Student progress tracking

## Support

For issues or questions:
- Check the API endpoint documentation above
- Review the database schema in the migration file
- Inspect browser console for client-side errors
- Check server logs for API errors

## License

MIT
