export interface Env {
  VAULT_URL: string
  AI_VAULT_TOKEN: string
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const body = await request.text()
    return fetch(env.VAULT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vault-token': env.AI_VAULT_TOKEN,
      },
      body,
    })
  },
}

