const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('./supabase');

router.get('/courses', async (req, res) => {
  try {
    const { data: courses, error } = await supabaseAdmin
      .from('lab_courses')
      .select('*')
      .eq('active', true)
      .order('name');

    if (error) {
      console.error('Error fetching courses:', error);
      return res.status(500).json({ error: 'Failed to fetch courses' });
    }

    res.json({ courses });

  } catch (error) {
    console.error('Error in /courses:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/workspaces', async (req, res) => {
  try {
    const { tenantId } = req.query;
    
    let query = supabaseAdmin
      .from('lab_workspaces')
      .select(`
        *,
        tenant:lab_tenants(id, name, slug, plan),
        _count:lab_workspace_members(count)
      `)
      .order('created_at', { ascending: false });

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: workspaces, error } = await query;

    if (error) {
      console.error('Error fetching workspaces:', error);
      return res.status(500).json({ error: 'Failed to fetch workspaces' });
    }

    const workspaceIds = workspaces.map(w => w.id);
    
    const { data: resources, error: resourcesError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('workspace_id, status')
      .in('workspace_id', workspaceIds)
      .is('deleted_at', null);

    if (resourcesError) {
      console.error('Error fetching resources:', resourcesError);
    }

    const resourceCounts = {};
    if (resources) {
      resources.forEach(r => {
        if (!resourceCounts[r.workspace_id]) {
          resourceCounts[r.workspace_id] = {
            total: 0,
            provisioning: 0,
            ready: 0,
            stopped: 0,
            failed: 0
          };
        }
        resourceCounts[r.workspace_id].total++;
        if (r.status === 'provisioning') resourceCounts[r.workspace_id].provisioning++;
        if (r.status === 'ready') resourceCounts[r.workspace_id].ready++;
        if (r.status === 'stopped') resourceCounts[r.workspace_id].stopped++;
        if (r.status === 'failed') resourceCounts[r.workspace_id].failed++;
      });
    }

    const enrichedWorkspaces = workspaces.map(w => ({
      ...w,
      resource_stats: resourceCounts[w.id] || {
        total: 0,
        provisioning: 0,
        ready: 0,
        stopped: 0,
        failed: 0
      }
    }));

    res.json({ workspaces: enrichedWorkspaces });

  } catch (error) {
    console.error('Error in /workspaces:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/workspace/:workspaceId/stats', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    
    const { data: workspace, error: workspaceError } = await supabaseAdmin
      .from('lab_workspaces')
      .select(`
        *,
        tenant:lab_tenants(id, name, slug, plan)
      `)
      .eq('id', workspaceId)
      .single();

    if (workspaceError || !workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    const { data: members, error: membersError } = await supabaseAdmin
      .from('lab_workspace_members')
      .select('id, user_id, email, name, role, status')
      .eq('workspace_id', workspaceId)
      .order('role');

    if (membersError) {
      console.error('Error fetching members:', membersError);
      return res.status(500).json({ error: 'Failed to fetch members' });
    }

    const { data: resources, error: resourcesError } = await supabaseAdmin
      .from('lab_workspace_resources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (resourcesError) {
      console.error('Error fetching resources:', resourcesError);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    const resourcesByUser = {};
    resources.forEach(r => {
      if (!resourcesByUser[r.user_id]) {
        resourcesByUser[r.user_id] = [];
      }
      resourcesByUser[r.user_id].push(r);
    });

    const memberStats = members.map(member => {
      const userResources = resourcesByUser[member.user_id] || [];
      const activeResources = userResources.filter(r => 
        !r.deleted_at && ['provisioning', 'ready', 'stopped'].includes(r.status)
      );
      
      return {
        ...member,
        lab_count: activeResources.length,
        labs: activeResources
      };
    });

    const stats = {
      workspace,
      members: memberStats,
      totals: {
        total_members: members.length,
        active_members: members.filter(m => m.status === 'active').length,
        trainers: members.filter(m => m.role === 'trainer').length,
        learners: members.filter(m => m.role === 'learner').length,
        observers: members.filter(m => m.role === 'observer').length,
        total_labs: resources.filter(r => !r.deleted_at).length,
        active_labs: resources.filter(r => !r.deleted_at && ['provisioning', 'ready', 'stopped'].includes(r.status)).length,
        ready_labs: resources.filter(r => !r.deleted_at && r.status === 'ready').length,
        stopped_labs: resources.filter(r => !r.deleted_at && r.status === 'stopped').length
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error in /workspace/:workspaceId/stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/tenants', async (req, res) => {
  try {
    const { data: tenants, error } = await supabaseAdmin
      .from('lab_tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tenants:', error);
      return res.status(500).json({ error: 'Failed to fetch tenants' });
    }

    res.json({ tenants });

  } catch (error) {
    console.error('Error in /tenants:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/resources/stats', async (req, res) => {
  try {
    const { tenantId, workspaceId } = req.query;
    
    let query = supabaseAdmin
      .from('lab_workspace_resources')
      .select(`
        *,
        workspace:lab_workspaces(id, name, tenant_id)
      `);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data: resources, error } = await query;

    if (error) {
      console.error('Error fetching resources:', error);
      return res.status(500).json({ error: 'Failed to fetch resources' });
    }

    let filteredResources = resources;
    if (tenantId) {
      filteredResources = resources.filter(r => r.workspace?.tenant_id === tenantId);
    }

    const stats = {
      total: filteredResources.length,
      active: filteredResources.filter(r => !r.deleted_at).length,
      by_status: {},
      by_kind: {}
    };

    filteredResources.forEach(r => {
      if (!stats.by_status[r.status]) stats.by_status[r.status] = 0;
      stats.by_status[r.status]++;
      
      if (!stats.by_kind[r.kind]) stats.by_kind[r.kind] = 0;
      stats.by_kind[r.kind]++;
    });

    res.json({ stats, resources: filteredResources });

  } catch (error) {
    console.error('Error in /resources/stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
