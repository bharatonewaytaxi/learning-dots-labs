// Initialize Supabase client
const supabaseUrl = window.SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseKey = window.SUPABASE_ANON_KEY || 'your-anon-key'
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey)

let currentUser = null
let userLabs = []

async function init() {
    // Get current user session
    const { data: { user } } = await supabase.auth.getUser()
    currentUser = user

    if (!currentUser) {
        document.getElementById('labs-container').innerHTML = 
            '<div class="loading">Please sign in to view your labs.</div>'
        return
    }

    loadUserLabs()
}

async function loadUserLabs() {
    try {
        const { data: resources, error } = await supabase
            .from('lab_workspace_resources')
            .select(`
                *,
                workspace:lab_workspaces(
                    id,
                    name,
                    course_id,
                    tenant:lab_tenants(name, subscription_status)
                )
            `)
            .eq('user_id', currentUser.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })

        if (error) throw error

        userLabs = resources || []
        renderLabs()

    } catch (error) {
        console.error('Error loading labs:', error)
        document.getElementById('labs-container').innerHTML = 
            '<div class="loading">Error loading labs. Please check console.</div>'
    }
}

function renderLabs() {
    const container = document.getElementById('labs-container')
    
    if (userLabs.length === 0) {
        container.innerHTML = '<p>No labs found. Labs are created when you launch them from your workspace.</p>'
        return
    }

    container.innerHTML = ''
    container.className = 'labs-grid'
    
    userLabs.forEach(lab => {
        const labCard = document.createElement('div')
        labCard.className = 'lab-card'
        
        const workspace = lab.workspace || {}
        const statusClass = `status-${lab.status}`
        const isSuspended = lab.status === 'suspended'
        const tenantSuspended = workspace.tenant?.subscription_status !== 'active'
        
        labCard.innerHTML = `
            <h3>${workspace.name || 'Unknown Workspace'}</h3>
            <span class="lab-status ${statusClass}">${lab.status}</span>
            <div class="lab-info"><strong>Course:</strong> ${workspace.course_id || 'Not specified'}</div>
            <div class="lab-info"><strong>Lab ID:</strong> ${lab.external_ref}</div>
            <div class="lab-info"><strong>Created:</strong> ${new Date(lab.created_at).toLocaleDateString()}</div>
            ${lab.expires_at ? `<div class="lab-info"><strong>Expires:</strong> ${new Date(lab.expires_at).toLocaleDateString()}</div>` : ''}
            ${isSuspended ? `
                <div style="margin-top: 12px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 13px;">
                    ${tenantSuspended ? '⚠️ Tenant subscription is inactive' : 'Lab suspended'}
                </div>
            ` : ''}
            ${lab.status === 'ready' && lab.usage?.connection_info ? `
                <div style="margin-top: 12px;">
                    <a href="${lab.usage.connection_info.url}" target="_blank" style="color: #667eea;">
                        Connect to Lab →
                    </a>
                </div>
            ` : ''}
        `
        
        container.appendChild(labCard)
    })
}

function showMessage(message, type = 'success') {
    const container = document.getElementById('message-container')
    const messageDiv = document.createElement('div')
    messageDiv.className = `message ${type}`
    messageDiv.textContent = message
    container.appendChild(messageDiv)
    
    setTimeout(() => {
        messageDiv.remove()
    }, 5000)
}

// Initialize on page load
init()

// Refresh every 15 seconds
setInterval(loadUserLabs, 15000)
