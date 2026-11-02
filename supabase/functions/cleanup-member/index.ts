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

    const { workspaceId, userId } = await req.json()

    if (!workspaceId || !userId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mark all labs for this user in this workspace as revoked
    const { data: resources, error: updateError } = await supabaseClient
      .from('lab_workspace_resources')
      .update({
        status: 'revoked',
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .in('status', ['provisioning', 'ready', 'stopped'])
      .select()

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to cleanup member labs', details: updateError.message }),
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
