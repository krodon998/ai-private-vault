import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-vault-token',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  })

const b64u = (value: string) => {
  const fixed = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(fixed + '='.repeat((4 - (fixed.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const pemBytes = (pem: string) => {
  const body = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    '',
  )
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
}

async function decryptEnvelope(
  envelope: Record<string, unknown>,
  sourceTag: string,
) {
  if (envelope.alg !== 'RSA-OAEP-256+A256GCM' || envelope.version !== 1) {
    throw new Error('unsupported envelope')
  }
  if (envelope.aad !== sourceTag) throw new Error('AAD mismatch')

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(Deno.env.get('AI_VAULT_PRIVATE_KEY')!),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    b64u(envelope.encrypted_key as string),
  )
  const aesKey = await crypto.subtle.importKey(
    'raw',
    aesRaw,
    'AES-GCM',
    false,
    ['decrypt'],
  )
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b64u(envelope.iv as string),
      additionalData: new TextEncoder().encode(sourceTag),
    },
    aesKey,
    b64u(envelope.ciphertext as string),
  )
  return new TextDecoder().decode(plaintext)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (req.headers.get('x-vault-token') !== Deno.env.get('AI_VAULT_TOKEN')) {
    return json({ error: 'unauthorized' }, 401)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  try {
    const body = await req.json()
    const action = body.action

    if (action === 'archive') {
      const { source_tag, cipher_envelope } = body
      if (!source_tag || cipher_envelope?.aad !== source_tag) {
        return json({ error: 'invalid envelope' }, 400)
      }
      if (
        cipher_envelope?.version !== 1 ||
        cipher_envelope?.alg !== 'RSA-OAEP-256+A256GCM'
      ) {
        return json({ error: 'unsupported envelope' }, 400)
      }
      const bytes = new TextEncoder().encode(JSON.stringify(cipher_envelope))
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      )
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
      const { data, error } = await admin
        .from('ai_private_entries')
        .insert({
          source_tag,
          envelope: cipher_envelope,
          key_version: cipher_envelope.key_version ?? 1,
          content_hash: hash,
        })
        .select('id,source_tag,key_version,created_at')
        .single()
      if (error) throw error
      return json({ ok: true, entry: data }, 201)
    }

    if (action === 'list') {
      const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 100)
      const { data, error } = await admin
        .from('ai_private_entries')
        .select('id,source_tag,key_version,created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return json({ ok: true, entries: data })
    }

    if (action === 'read') {
      const { source_tag } = body
      if (typeof source_tag !== 'string' || source_tag.length < 6) {
        return json({ error: 'invalid source_tag' }, 400)
      }
      const { data, error } = await admin
        .from('ai_private_entries')
        .select('id,source_tag,envelope,key_version,created_at')
        .eq('source_tag', source_tag)
        .single()
      if (error) throw error
      const plaintext = await decryptEnvelope(data.envelope, data.source_tag)
      return json({
        ok: true,
        entry: {
          id: data.id,
          source_tag: data.source_tag,
          created_at: data.created_at,
          plaintext,
        },
      })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: 'request failed' }, 500)
  }
})

