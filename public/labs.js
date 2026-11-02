const MOCK_USER_ID = 'user-' + Math.random().toString(36).substr(2, 9);

let workspaces = [];
let courses = [];
let userLabs = [];

function showMessage(message, type = 'success') {
    const container = document.getElementById('message-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    container.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 5000);
}

async function loadWorkspaces() {
    try {
        const response = await fetch('/api/admin/workspaces');
        const data = await response.json();
        
        if (data.workspaces) {
            workspaces = data.workspaces.filter(w => w.status === 'active');
            
            const select = document.getElementById('workspace-select');
            select.innerHTML = '<option value="">Select a workspace...</option>';
            
            workspaces.forEach(workspace => {
                const option = document.createElement('option');
                option.value = workspace.id;
                option.textContent = `${workspace.name} (${workspace.tenant?.name || 'Unknown'})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading workspaces:', error);
        showMessage('Failed to load workspaces', 'error');
    }
}

async function loadCourses() {
    try {
        const response = await fetch('/api/admin/courses');
        const data = await response.json();
        
        if (data.courses) {
            courses = data.courses;
            
            const select = document.getElementById('course-select');
            select.innerHTML = '<option value="">Select a course...</option>';
            
            courses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.course_id;
                option.textContent = course.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading courses:', error);
        showMessage('Failed to load courses', 'error');
    }
}

async function loadUserLabs() {
    try {
        const response = await fetch(`/api/labs/user/${MOCK_USER_ID}`);
        const data = await response.json();
        
        if (data.resources) {
            userLabs = data.resources;
            renderLabs();
        }
    } catch (error) {
        console.error('Error loading labs:', error);
        document.getElementById('labs-container').innerHTML = '<p>Failed to load labs</p>';
    }
}

function renderLabs() {
    const container = document.getElementById('labs-container');
    
    if (userLabs.length === 0) {
        container.innerHTML = '<p>No labs found. Request a lab to get started.</p>';
        return;
    }
    
    container.innerHTML = '';
    container.className = 'labs-grid';
    
    userLabs.forEach(lab => {
        const labCard = document.createElement('div');
        labCard.className = 'lab-card';
        
        const workspace = lab.workspace || {};
        const statusClass = `status-${lab.status}`;
        
        labCard.innerHTML = `
            <h3>${workspace.name || 'Unknown Workspace'}</h3>
            <span class="lab-status ${statusClass}">${lab.status}</span>
            <div class="lab-info">Course: ${workspace.course_id || 'Not specified'}</div>
            <div class="lab-info">Lab ID: ${lab.external_ref}</div>
            <div class="lab-info">Created: ${new Date(lab.created_at).toLocaleDateString()}</div>
            ${lab.expires_at ? `<div class="lab-info">Expires: ${new Date(lab.expires_at).toLocaleDateString()}</div>` : ''}
            <div class="lab-actions">
                ${lab.status === 'ready' ? `<button onclick="connectToLab('${lab.id}')">Connect</button>` : ''}
                ${lab.status === 'stopped' ? `<button class="btn-secondary" onclick="startLab('${lab.id}')">Start</button>` : ''}
                ${lab.status === 'ready' ? `<button class="btn-secondary" onclick="stopLab('${lab.id}')">Stop</button>` : ''}
                ${lab.status === 'suspended' ? `<div style="font-size: 12px; color: #666; margin-top: 8px;">Suspended - Tenant subscription inactive</div>` : ''}
                ${['ready', 'stopped'].includes(lab.status) ? `<button class="btn-danger" onclick="deleteLab('${lab.id}')">Delete</button>` : ''}
            </div>
        `;
        
        container.appendChild(labCard);
    });
}

async function requestLab() {
    const workspaceId = document.getElementById('workspace-select').value;
    const courseId = document.getElementById('course-select').value;
    
    if (!workspaceId) {
        showMessage('Please select a workspace', 'error');
        return;
    }
    
    const button = document.getElementById('request-lab-btn');
    button.disabled = true;
    button.textContent = 'Requesting...';
    
    try {
        const response = await fetch('/api/labs/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                workspaceId,
                userId: MOCK_USER_ID,
                courseId: courseId || undefined
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('Lab request submitted! Provisioning in progress...');
            setTimeout(() => loadUserLabs(), 2000);
        } else {
            showMessage(data.error || 'Failed to request lab', 'error');
        }
    } catch (error) {
        console.error('Error requesting lab:', error);
        showMessage('Failed to request lab', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Request Lab';
    }
}

async function connectToLab(resourceId) {
    showMessage('Opening lab connection...');
}

async function startLab(resourceId) {
    try {
        const response = await fetch('/api/labs/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resourceId,
                status: 'ready'
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('Lab started successfully');
            loadUserLabs();
        } else {
            showMessage(data.error || 'Failed to start lab', 'error');
        }
    } catch (error) {
        console.error('Error starting lab:', error);
        showMessage('Failed to start lab', 'error');
    }
}

async function stopLab(resourceId) {
    try {
        const response = await fetch('/api/labs/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resourceId,
                status: 'stopped'
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('Lab stopped successfully');
            loadUserLabs();
        } else {
            showMessage(data.error || 'Failed to stop lab', 'error');
        }
    } catch (error) {
        console.error('Error stopping lab:', error);
        showMessage('Failed to stop lab', 'error');
    }
}

async function deleteLab(resourceId) {
    if (!confirm('Are you sure you want to delete this lab? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/labs/teardown/${resourceId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            showMessage('Lab deletion initiated');
            loadUserLabs();
        } else {
            showMessage(data.error || 'Failed to delete lab', 'error');
        }
    } catch (error) {
        console.error('Error deleting lab:', error);
        showMessage('Failed to delete lab', 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadWorkspaces();
    loadCourses();
    loadUserLabs();
    
    setInterval(loadUserLabs, 10000);
});
