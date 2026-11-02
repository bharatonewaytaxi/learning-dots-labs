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

    const { workspaceId } = await req.json()

    if (!workspaceId) {
      return new Response(
        JSON.stringify({ error: 'Missing workspace ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get workspace and check if it should be cleaned up
    const { data: workspace, error: wsError } = await supabaseClient
      .from('lab_workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single()

    if (wsError || !workspace) {
      return new Response(
        JSON.stringify({ error: 'Workspace not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const shouldCleanup = workspace.status === 'closed' || 
                         (workspace.end_date && new Date(workspace.end_date) < new Date())

    if (!shouldCleanup) {
      return new Response(
        JSON.stringify({ error: 'Workspace is still active' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark all active labs as expired
    const { data: resources, error: updateError } = await supabaseClient
      .from('lab_workspace_resources')
      .update({
        status: 'expired',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('status', ['provisioning', 'ready', 'stopped'])
      .select()

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to cleanup labs', details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Marked ${resources?.length || 0} lab(s) for cleanup`,
        resources: resources || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
