// Initialize Supabase client (configure with your project URL and anon key)
const supabaseUrl = window.SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseKey = window.SUPABASE_ANON_KEY || 'your-anon-key'
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey)

let workspaces = []
let allResources = []

async function loadData() {
    try {
        // Load workspaces with tenant info
        const { data: workspacesData, error: wsError } = await supabase
            .from('lab_workspaces')
            .select(`
                *,
                tenant:lab_tenants(id, name, slug, plan, subscription_status)
            `)
            .order('created_at', { ascending: false })

        if (wsError) throw wsError

        workspaces = workspacesData || []

        // Load all resources for these workspaces
        const workspaceIds = workspaces.map(w => w.id)
        if (workspaceIds.length > 0) {
            const { data: resourcesData, error: resError } = await supabase
                .from('lab_workspace_resources')
                .select('*')
                .in('workspace_id', workspaceIds)
                .is('deleted_at', null)

            if (resError) throw resError
            allResources = resourcesData || []
        }

        renderWorkspaces()
        updateStats()

    } catch (error) {
        console.error('Error loading data:', error)
        document.getElementById('workspaces-container').innerHTML = 
            '<div class="loading">Error loading data. Please check console.</div>'
    }
}

function updateStats() {
    const activeWorkspaces = workspaces.filter(w => w.status === 'active').length
    const totalLabs = allResources.length
    const readyLabs = allResources.filter(r => r.status === 'ready').length
    const suspendedLabs = allResources.filter(r => r.status === 'suspended').length

    document.getElementById('stat-workspaces').textContent = activeWorkspaces
    document.getElementById('stat-labs').textContent = totalLabs
    document.getElementById('stat-ready').textContent = readyLabs
    document.getElementById('stat-suspended').textContent = suspendedLabs
}

function renderWorkspaces() {
    const container = document.getElementById('workspaces-container')
    
    if (workspaces.length === 0) {
        container.innerHTML = '<div class="loading">No workspaces found.</div>'
        return
    }

    const table = document.createElement('table')
    table.innerHTML = `
        <thead>
            <tr>
                <th>Workspace Name</th>
                <th>Tenant</th>
                <th>Course</th>
                <th>Status</th>
                <th>Lab Seats</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="workspaces-tbody"></tbody>
    `
    
    container.innerHTML = ''
    container.appendChild(table)

    const tbody = document.getElementById('workspaces-tbody')
    
    workspaces.forEach(workspace => {
        const resources = allResources.filter(r => r.workspace_id === workspace.id)
        const readyCount = resources.filter(r => r.status === 'ready').length
        const suspendedCount = resources.filter(r => r.status === 'suspended').length
        const totalCount = resources.length

        const row = document.createElement('tr')
        row.style.cursor = 'pointer'
        
        const tenantName = workspace.tenant?.name || 'N/A'
        const planBadge = workspace.tenant?.plan ? 
            `<span class="badge badge-${workspace.tenant.plan}">${workspace.tenant.plan}</span>` : ''
        const subscriptionBadge = workspace.tenant?.subscription_status !== 'active' ?
            `<span class="badge badge-suspended">⚠️ ${workspace.tenant.subscription_status}</span>` : ''
        
        const labInfo = `${readyCount} ready / ${totalCount} total${suspendedCount > 0 ? ` (${suspendedCount} suspended)` : ''}`
        
        row.innerHTML = `
            <td><strong>${workspace.name}</strong></td>
            <td>${tenantName} ${planBadge} ${subscriptionBadge}</td>
            <td>${workspace.course_id || 'Not set'}</td>
            <td><span class="badge badge-${workspace.status}">${workspace.status}</span></td>
            <td>${labInfo}</td>
            <td>${new Date(workspace.created_at).toLocaleDateString()}</td>
            <td><button onclick="viewDetails('${workspace.id}')">View</button></td>
        `
        
        tbody.appendChild(row)
    })
}

async function viewDetails(workspaceId) {
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return

    try {
        // Load members for this workspace
        const { data: members, error: membersError } = await supabase
            .from('lab_workspace_members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('role')

        if (membersError) throw membersError

        // Get resources for each member
        const workspaceResources = allResources.filter(r => r.workspace_id === workspaceId)
        
        const membersWithLabs = members.map(member => {
            const userLabs = workspaceResources.filter(r => r.user_id === member.user_id)
            return {
                ...member,
                lab_count: userLabs.length,
                labs: userLabs
            }
        })

        showDetailsModal(workspace, membersWithLabs)

    } catch (error) {
        console.error('Error loading details:', error)
        alert('Failed to load workspace details')
    }
}

function showDetailsModal(workspace, members) {
    const modal = document.createElement('div')
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    `

    const content = document.createElement('div')
    content.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 800px;
        max-height: 80vh;
        overflow-y: auto;
    `

    const subscriptionStatus = workspace.tenant?.subscription_status === 'active' ? 'active' : 'suspended'

    content.innerHTML = `
        <h2>${workspace.name}</h2>
        <p><strong>Tenant:</strong> ${workspace.tenant?.name} (${workspace.tenant?.plan})</p>
        <p><strong>Subscription:</strong> <span class="badge badge-${subscriptionStatus}">${workspace.tenant?.subscription_status || 'unknown'}</span></p>
        <p><strong>Course:</strong> ${workspace.course_id || 'Not set'}</p>
        <p><strong>Status:</strong> ${workspace.status}</p>
        
        <h3 style="margin-top: 20px;">Members & Lab Seats (${members.length})</h3>
        <div class="members-list">
            ${members.map(member => `
                <div class="member-card">
                    <div class="member-name">${member.name || member.email}</div>
                    <div style="font-size: 13px; color: #666;">${member.email}</div>
                    <div style="margin-top: 4px;">
                        <span class="badge badge-${member.role === 'trainer' ? 'pro' : 'active'}">${member.role}</span>
                    </div>
                    <div class="lab-count">Labs: ${member.lab_count}</div>
                    ${member.labs.map(lab => `
                        <div style="margin-top: 8px; font-size: 12px; color: #666;">
                            <span class="badge badge-${lab.status}">${lab.status}</span> 
                            ${lab.external_ref}
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>
        
        <button onclick="this.closest('div[style*=fixed]').remove()" style="margin-top: 20px;">Close</button>
    `

    modal.appendChild(content)
    document.body.appendChild(modal)

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove()
    })
}

// Load data on page load
loadData()

// Refresh every 30 seconds
setInterval(loadData, 30000)
