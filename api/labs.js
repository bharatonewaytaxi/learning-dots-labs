const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('./supabase');

async function provisionLab(labConfig) {
  console.log('Provisioning lab:', labConfig);
  
  const labId = `lab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    id: labId,
    status: 'ready',
    connectionInfo: {
      url: `https://lab.example.com/${labId}`,
      credentials: {
        username: 'learner',
        password: 'temp-password'
      }
    }
  };
}

async function teardownLab(labId) {
  console.log('Tearing down lab:', labId);
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return { success: true };
}

router.post('/create', async (req, res) => {
  try {
    const { workspaceId, userId, courseId, labType } = req.body;
    
    if (!workspaceId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('lab_workspaces')
      .select('*, tenant:lab_tenants(*)')
      .eq('id', workspaceId)
      .single();

    if (workspaceError || !workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    if (workspace.status === 'closed' || workspace.status === 'archived') {
      return res.status(400).json({ error: 'Workspace is not active' });
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from('lab_workspace_members')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (memberError || !member) {
      return res.status(403).json({ error: 'User is not a member of this workspace' });
    }

    const { data: existingResource } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('kind', 'lab')
      .is('deleted_at', null)
      .in('status', ['provisioning', 'ready', 'stopped'])
      .single();

    if (existingResource) {
      return res.status(400).json({ 
        error: 'User already has an active lab in this workspace',
        resource: existingResource 
      });
    }

    const labConfig = {
      workspaceId,
      userId,
      courseId: courseId || workspace.course_id,
      labType: labType || 'standard'
    };

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data: resource, error: resourceError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        kind: 'lab',
        external_ref: 'pending',
        status: 'provisioning',
        expires_at: expiresAt,
        usage: { created_via: 'api', lab_config: labConfig }
      })
      .select()
      .single();

    if (resourceError) {
      console.error('Error creating resource record:', resourceError);
      return res.status(500).json({ error: 'Failed to create lab resource' });
    }

    provisionLab(labConfig)
      .then(async (lab) => {
        await supabaseAdmin
          .from('lab_workspace_resources')
          .update({
            external_ref: lab.id,
            status: lab.status,
            usage: { 
              ...resource.usage, 
              connection_info: lab.connectionInfo,
              provisioned_at: new Date().toISOString()
            }
          })
          .eq('id', resource.id);
        
        console.log('Lab provisioned successfully:', lab.id);
      })
      .catch(async (error) => {
        console.error('Lab provisioning failed:', error);
        await supabaseAdmin
          .from('lab_workspace_resources')
          .update({
            status: 'failed',
            usage: { ...resource.usage, error: error.message }
          })
          .eq('id', resource.id);
      });

    res.json({ 
      success: true, 
      resource: {
        id: resource.id,
        status: resource.status,
        message: 'Lab is being provisioned'
      }
    });

  } catch (error) {
    console.error('Error in /create:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/workspace/:workspaceId', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    
    const { data: resources, error } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select(`
        *,
        workspace:lab_workspaces(id, name, course_id),
        member:lab_workspace_members!inner(user_id, email, name, role)
      `)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching workspace resources:', error);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    res.json({ resources });

  } catch (error) {
    console.error('Error in /workspace/:workspaceId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data: resources, error } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select(`
        *,
        workspace:lab_workspaces(id, name, course_id, tenant_id)
      `)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user resources:', error);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    res.json({ resources });

  } catch (error) {
    console.error('Error in /user/:userId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/update-status', async (req, res) => {
  try {
    const { resourceId, status, usage } = req.body;
    
    if (!resourceId || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const updateData = { status };
    if (usage) {
      updateData.usage = usage;
    }

    const { data: resource, error } = await supabaseAdmin
      .from('lab_workspace_resources')
      .update(updateData)
      .eq('id', resourceId)
      .select()
      .single();

    if (error) {
      console.error('Error updating resource status:', error);
      return res.status(500).json({ error: 'Failed to update resource' });
    }

    res.json({ success: true, resource });

  } catch (error) {
    console.error('Error in /update-status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/teardown/:resourceId', async (req, res) => {
  try {
    const { resourceId } = req.params;
    
    const { data: resource, error: fetchError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('*')
      .eq('id', resourceId)
      .single();

    if (fetchError || !resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    if (resource.status === 'deleted') {
      return res.json({ success: true, message: 'Resource already deleted' });
    }

    await supabaseAdmin
      .from('lab_workspace_resources')
      .update({ 
        status: 'deleting',
        deleted_at: new Date().toISOString()
      })
      .eq('id', resourceId);

    if (resource.external_ref && resource.external_ref !== 'pending') {
      teardownLab(resource.external_ref)
        .then(async () => {
          await supabaseAdmin
            .from('lab_workspace_resources')
            .update({ status: 'deleted' })
            .eq('id', resourceId);
          
          console.log('Lab torn down successfully:', resource.external_ref);
        })
        .catch(async (error) => {
          console.error('Lab teardown failed:', error);
          await supabaseAdmin
            .from('lab_workspace_resources')
            .update({ status: 'delete-failed' })
            .eq('id', resourceId);
        });
    } else {
      await supabaseAdmin
        .from('lab_workspace_resources')
        .update({ status: 'deleted' })
        .eq('id', resourceId);
    }

    res.json({ success: true, message: 'Lab teardown initiated' });

  } catch (error) {
    console.error('Error in /teardown/:resourceId:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cleanup-workspace', async (req, res) => {
  try {
    const { workspaceId } = req.body;
    
    if (!workspaceId) {
      return res.status(400).json({ error: 'Missing workspace ID' });
    }

    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('lab_workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single();

    if (workspaceError || !workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const shouldCleanup = workspace.status === 'closed' || 
                         (workspace.end_date && new Date(workspace.end_date) < new Date());

    if (!shouldCleanup) {
      return res.status(400).json({ error: 'Workspace is still active' });
    }

    const { data: resources, error: resourcesError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('status', ['provisioning', 'ready', 'stopped']);

    if (resourcesError) {
      console.error('Error fetching resources:', resourcesError);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    let cleanedUp = 0;
    for (const resource of resources) {
      await supabaseAdmin
        .from('lab_workspace_resources')
        .update({ 
          status: 'expired',
          deleted_at: new Date().toISOString()
        })
        .eq('id', resource.id);

      if (resource.external_ref && resource.external_ref !== 'pending') {
        teardownLab(resource.external_ref).catch(error => {
          console.error(`Failed to teardown lab ${resource.external_ref}:`, error);
        });
      }
      
      cleanedUp++;
    }

    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedUp} lab(s)`,
      workspace: workspaceId
    });

  } catch (error) {
    console.error('Error in /cleanup-workspace:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cleanup-member', async (req, res) => {
  try {
    const { workspaceId, userId } = req.body;
    
    if (!workspaceId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: resources, error: resourcesError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('status', ['provisioning', 'ready', 'stopped']);

    if (resourcesError) {
      console.error('Error fetching resources:', resourcesError);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    let cleanedUp = 0;
    for (const resource of resources) {
      await supabaseAdmin
        .from('lab_workspace_resources')
        .update({ 
          status: 'revoked',
          deleted_at: new Date().toISOString()
        })
        .eq('id', resource.id);

      if (resource.external_ref && resource.external_ref !== 'pending') {
        teardownLab(resource.external_ref).catch(error => {
          console.error(`Failed to teardown lab ${resource.external_ref}:`, error);
        });
      }
      
      cleanedUp++;
    }

    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedUp} lab(s) for user`,
      workspaceId,
      userId
    });

  } catch (error) {
    console.error('Error in /cleanup-member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
