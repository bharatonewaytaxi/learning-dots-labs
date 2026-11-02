let workspaces = [];
let tenants = [];
let allStats = { total: 0, active: 0, by_status: {} };

async function loadTenants() {
    try {
        const response = await fetch('/api/admin/tenants');
        const data = await response.json();
        
        if (data.tenants) {
            tenants = data.tenants;
            
            const select = document.getElementById('tenant-filter');
            select.innerHTML = '<option value="">All Tenants</option>';
            
            tenants.forEach(tenant => {
                const option = document.createElement('option');
                option.value = tenant.id;
                option.textContent = `${tenant.name} (${tenant.plan})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading tenants:', error);
    }
}

async function loadWorkspaces() {
    try {
        const tenantId = document.getElementById('tenant-filter').value;
        const url = tenantId ? `/api/admin/workspaces?tenantId=${tenantId}` : '/api/admin/workspaces';
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.workspaces) {
            workspaces = data.workspaces;
            renderWorkspaces();
        }
    } catch (error) {
        console.error('Error loading workspaces:', error);
        document.getElementById('workspaces-container').innerHTML = '<p>Failed to load workspaces</p>';
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/admin/resources/stats');
        const data = await response.json();
        
        if (data.stats) {
            allStats = data.stats;
            updateStatsDisplay();
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function updateStatsDisplay() {
    const activeWorkspaces = workspaces.filter(w => w.status === 'active').length;
    document.getElementById('stat-workspaces').textContent = activeWorkspaces;
    document.getElementById('stat-labs').textContent = allStats.active || 0;
    document.getElementById('stat-ready').textContent = allStats.by_status.ready || 0;
    document.getElementById('stat-provisioning').textContent = allStats.by_status.provisioning || 0;
}

function renderWorkspaces() {
    const container = document.getElementById('workspaces-container');
    
    if (workspaces.length === 0) {
        container.innerHTML = '<p>No workspaces found.</p>';
        return;
    }
    
    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Workspace Name</th>
                <th>Tenant</th>
                <th>Course</th>
                <th>Status</th>
                <th>Labs</th>
                <th>Created</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody id="workspaces-tbody"></tbody>
    `;
    
    container.innerHTML = '';
    container.appendChild(table);
    
    const tbody = document.getElementById('workspaces-tbody');
    
    workspaces.forEach(workspace => {
        const row = document.createElement('tr');
        row.className = 'workspace-row';
        row.dataset.workspaceId = workspace.id;
        
        const statusBadge = `<span class="badge badge-${workspace.status}">${workspace.status}</span>`;
        const planBadge = workspace.tenant?.plan ? 
            `<span class="badge badge-${workspace.tenant.plan}">${workspace.tenant.plan}</span>` : '';
        const subscriptionBadge = workspace.tenant?.subscription_status !== 'active' ?
            `<span class="badge badge-suspended">⚠️ ${workspace.tenant.subscription_status}</span>` : '';
        
        const stats = workspace.resource_stats || {};
        const labsInfo = `${stats.ready || 0} ready / ${stats.total || 0} total${stats.suspended ? ` (${stats.suspended} suspended)` : ''}`;
        
        row.innerHTML = `
            <td><strong>${workspace.name}</strong></td>
            <td>${workspace.tenant?.name || 'N/A'} ${planBadge} ${subscriptionBadge}</td>
            <td>${workspace.course_id || 'Not set'}</td>
            <td>${statusBadge}</td>
            <td>${labsInfo}</td>
            <td>${new Date(workspace.created_at).toLocaleDateString()}</td>
            <td><button onclick="toggleWorkspaceDetails('${workspace.id}')">View Details</button></td>
        `;
        
        tbody.appendChild(row);
        
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${workspace.id}`;
        detailsRow.innerHTML = `<td colspan="7"><div class="workspace-details" id="details-content-${workspace.id}"></div></td>`;
        tbody.appendChild(detailsRow);
    });
    
    updateStatsDisplay();
}

async function toggleWorkspaceDetails(workspaceId) {
    const detailsDiv = document.getElementById(`details-content-${workspaceId}`);
    
    if (detailsDiv.classList.contains('expanded')) {
        detailsDiv.classList.remove('expanded');
        return;
    }
    
    detailsDiv.innerHTML = '<div class="loading">Loading workspace details...</div>';
    detailsDiv.classList.add('expanded');
    
    try {
        const response = await fetch(`/api/admin/workspace/${workspaceId}/stats`);
        const data = await response.json();
        
        if (data.workspace) {
            renderWorkspaceDetails(workspaceId, data);
        }
    } catch (error) {
        console.error('Error loading workspace details:', error);
        detailsDiv.innerHTML = '<p>Failed to load workspace details</p>';
    }
}

function renderWorkspaceDetails(workspaceId, data) {
    const detailsDiv = document.getElementById(`details-content-${workspaceId}`);
    
    const { workspace, members, totals } = data;
    
    let html = `
        <div style="margin-bottom: 20px;">
            <h3>${workspace.name}</h3>
            <p><strong>Description:</strong> ${workspace.description || 'No description'}</p>
            <p><strong>Tenant:</strong> ${workspace.tenant?.name} (${workspace.tenant?.plan})</p>
            <p><strong>Subscription Status:</strong> <span class="badge badge-${workspace.tenant?.subscription_status === 'active' ? 'active' : 'suspended'}">${workspace.tenant?.subscription_status || 'unknown'}</span></p>
            <p><strong>Start Date:</strong> ${workspace.start_date ? new Date(workspace.start_date).toLocaleDateString() : 'Not set'}</p>
            <p><strong>End Date:</strong> ${workspace.end_date ? new Date(workspace.end_date).toLocaleDateString() : 'Not set'}</p>
        </div>

        <div style="margin-bottom: 20px;">
            <h4>Summary</h4>
            <div class="stats-grid">
                <div class="stat-card" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);">
                    <div class="stat-value">${totals.active_members}</div>
                    <div class="stat-label">Active Members</div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);">
                    <div class="stat-value">${totals.trainers}</div>
                    <div class="stat-label">Trainers</div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                    <div class="stat-value">${totals.learners}</div>
                    <div class="stat-label">Learners</div>
                </div>
                <div class="stat-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
                    <div class="stat-value">${totals.active_labs}</div>
                    <div class="stat-label">Active Labs</div>
                </div>
                ${totals.suspended_labs > 0 ? `
                <div class="stat-card" style="background: linear-gradient(135deg, #868f96 0%, #596164 100%);">
                    <div class="stat-value">${totals.suspended_labs}</div>
                    <div class="stat-label">Suspended Labs</div>
                </div>
                ` : ''}
            </div>
        </div>

        <div>
            <h4>Members & Lab Seats</h4>
            <div class="members-grid">
    `;
    
    members.forEach(member => {
        const roleClass = member.role === 'trainer' ? 'badge-enterprise' : 'badge-active';
        html += `
            <div class="member-card">
                <div class="member-name">${member.name || 'Unknown'}</div>
                <div class="member-info">${member.email}</div>
                <div class="member-info">
                    <span class="badge ${roleClass}">${member.role}</span>
                    <span class="badge badge-${member.status}">${member.status}</span>
                </div>
                <div class="lab-count">Labs: ${member.lab_count}</div>
                ${member.labs && member.labs.length > 0 ? `
                    <div style="margin-top: 8px; font-size: 12px; color: #666;">
                        ${member.labs.map(lab => `
                            <div style="margin-top: 4px;">
                                <span class="badge badge-${lab.status}">${lab.status}</span> 
                                ${lab.external_ref}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    detailsDiv.innerHTML = html;
}

async function loadAllData() {
    await Promise.all([
        loadTenants(),
        loadWorkspaces(),
        loadStats()
    ]);
}

document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
    
    document.getElementById('tenant-filter').addEventListener('change', () => {
        loadWorkspaces();
    });
    
    setInterval(() => {
        loadWorkspaces();
        loadStats();
    }, 15000);
});
