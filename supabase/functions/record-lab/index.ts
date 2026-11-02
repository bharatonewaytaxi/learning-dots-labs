import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { workspaceId, userId, labId, status, usage, expiresAt } = await req.json()

    if (!workspaceId || !userId || !labId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check tenant subscription status
    const { data: workspace, error: wsError } = await supabaseClient
      .from('lab_workspaces')
      .select('*, tenant:lab_tenants!inner(*)')
      .eq('id', workspaceId)
      .single()

    if (wsError || !workspace) {
      return new Response(
        JSON.stringify({ error: 'Workspace not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (workspace.tenant?.subscription_status !== 'active') {
      return new Response(
        JSON.stringify({ 
          error: 'Tenant subscription is not active',
          subscription_status: workspace.tenant?.subscription_status
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Record or update lab resource
    const { data: resource, error: resourceError } = await supabaseClient
      .from('lab_workspace_resources')
      .upsert({
        workspace_id: workspaceId,
        user_id: userId,
        kind: 'lab',
        external_ref: labId,
        status: status || 'provisioning',
        usage: usage || {},
        expires_at: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'workspace_id,user_id,external_ref',
        ignoreDuplicates: false
      })
      .select()
      .single()

    if (resourceError) {
      return new Response(
        JSON.stringify({ error: 'Failed to record lab resource', details: resourceError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, resource }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
