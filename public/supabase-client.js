/* The build supplies the official SDK. Local Express pages keep their existing API. */
(() => {
  'use strict';
  window.createGrimorioSupabaseAdapter = function createGrimorioSupabaseAdapter(createClient, config) {
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const pdfPaths = new Map();
    const profileColumns = 'id,display_name,avatar_data,account_code,role,created_at';
    const bookColumns = 'id,title,description,cover_data,pdf_path,created_at';
    const messageFor = error => ({
      invalid_credentials: 'E-mail ou senha incorretos.',
      email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
      user_already_exists: 'Já existe uma conta com este e-mail.',
      over_email_send_rate_limit: 'Aguarde alguns minutos antes de solicitar outro e-mail.',
      weak_password: 'A senha precisa ter pelo menos 8 caracteres.',
      '42501': 'Você não tem permissão para alterar estes dados.',
      PGRST116: 'Registro não encontrado ou acesso não permitido.'
    }[error?.code] || error?.message || 'Não foi possível concluir.');
    async function result(query) {
      const response = await query;
      if (response.error) throw new Error(messageFor(response.error));
      return response.data;
    }
    function profile(row, email = '') {
      return { id: row.id, displayName: row.display_name, avatarData: row.avatar_data,
        accountCode: row.account_code, role: row.role, createdAt: row.created_at, email };
    }
    function sheet(row) {
      return { id: row.id, name: row.name, data: row.data_json, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    function campaign(row) {
      return { id: row.id, code: row.code, name: row.name, systemName: row.system_name,
        status: row.status, createdAt: row.created_at, state: row.state_json || { tokens: [], rolls: [] } };
    }
    async function session(required = true) {
      const data = await result(client.auth.getSession());
      if (!data.session && required) {
        const error = new Error('Faça login para continuar.'); error.status = 401; throw error;
      }
      return data.session;
    }
    async function currentUser() {
      const auth = await session();
      const row = await result(client.from('profiles').select(profileColumns).eq('id', auth.user.id).single());
      return profile(row, auth.user.email || '');
    }
    async function admin() {
      if ((await currentUser()).role !== 'admin') throw new Error('Somente administradores podem alterar o catálogo e o anúncio.');
    }
    function clean(value, limit) { return String(value ?? '').trim().slice(0, limit); }
    function sheetValues(body) {
      const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
      return { name: clean(data.name, 70) || 'Novo personagem', data_json: data };
    }
    function publicPdfUrl(book, download = false) {
      const path = typeof book === 'object' ? book.pdfPath || book.pdf_path : pdfPaths.get(book);
      if (!path) throw new Error('O PDF deste livro está indisponível. Atualize o catálogo.');
      return client.storage.from('book-pdfs').getPublicUrl(path, download ? { download: true } : {}).data.publicUrl;
    }
    async function members(code) {
      const info = await result(client.rpc('get_campaign', { p_code: code }));
      if (info.role === 'guest') throw new Error('Entre na campanha para acessar os participantes.');
      const rows = await result(client.from('campaign_members').select('user_id,player_name,joined_at').eq('campaign_id', info.campaign.id).order('joined_at'));
      const profiles = rows.length ? await result(client.from('profiles').select(profileColumns).in('id', rows.map(row => row.user_id))) : [];
      const owner = await result(client.from('campaigns').select('owner_user_id').eq('id', info.campaign.id).single());
      return { info, rows, members: rows.map(row => ({
        ...profile(profiles.find(person => person.id === row.user_id) || { id: row.user_id }),
        playerName: row.player_name, isMaster: owner.owner_user_id === row.user_id, joinedAt: row.joined_at
      })) };
    }
    async function masterContext(code, sheetId) {
      const context = await members(code);
      if (context.info.role !== 'master') throw new Error('Somente o mestre pode acessar as fichas da campanha.');
      if (sheetId) {
        const row = await result(client.from('character_sheets').select('*').eq('id', sheetId).in('user_id', context.rows.map(member => member.user_id)).single());
        context.sheet = row;
      }
      return context;
    }
    async function request(url, options = {}) {
      const parsed = new URL(url, window.location.origin);
      const path = parsed.pathname.replace(/\/$/, '');
      const method = (options.method || 'GET').toUpperCase();
      const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
      let match;
      if ((path === '/api/auth/register' || path === '/api/auth/login') && method === 'POST') {
        const credentials = { email: clean(body.email, 320).toLowerCase(), password: String(body.password || '') };
        const data = await result(path.endsWith('/register')
          ? client.auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin + '/', data: { display_name: credentials.email.split('@')[0].slice(0, 32) } } })
          : client.auth.signInWithPassword(credentials));
        if (!data.session) throw new Error('Conta criada. Confira seu e-mail e confirme o cadastro antes de entrar.');
        return { token: data.session.access_token, user: await currentUser() };
      }
      if (path === '/api/auth/logout' && method === 'POST') { await result(client.auth.signOut()); return null; }
      if (path === '/api/auth/me' && method === 'GET') return { user: await currentUser() };
      if (path === '/api/content/permissions' && method === 'GET') {
        return { canManageContent: (await session(false)) ? (await currentUser()).role === 'admin' : false };
      }
      if (path === '/api/books' && method === 'GET') {
        const rows = await result(client.from('books').select(bookColumns).order('created_at', { ascending: false }));
        return { books: rows.map(row => {
          pdfPaths.set(row.id, row.pdf_path);
          return { id: row.id, title: row.title, description: row.description, coverData: row.cover_data, pdfPath: row.pdf_path, createdAt: row.created_at };
        }) };
      }
      if (path === '/api/home-feature' && method === 'GET') {
        const row = await result(client.from('site_settings').select('value').eq('key', 'home_feature').maybeSingle());
        return row?.value || { imageData: '/assets/grimorio-book.png', bookId: '' };
      }
      const auth = await session();
      const uid = auth.user.id;
      if (path === '/api/profile' && method === 'PUT') {
        const displayName = clean(body.displayName, 32);
        if (!displayName) throw new Error('Informe seu nome de exibição.');
        const row = await result(client.from('profiles').update({ display_name: displayName, avatar_data: body.avatarData || '' }).eq('id', uid).select(profileColumns).single());
        return { user: profile(row, auth.user.email || '') };
      }
      if (path === '/api/sheets' && method === 'GET') {
        const rows = await result(client.from('character_sheets').select('*').eq('user_id', uid).order('updated_at', { ascending: false }));
        return { sheets: rows.map(sheet) };
      }
      if (path === '/api/sheets' && method === 'POST') {
        return sheet(await result(client.from('character_sheets').insert({ user_id: uid, ...sheetValues(body) }).select('*').single()));
      }
      if ((match = path.match(/^\/api\/sheets\/([^/]+)$/))) {
        if (method === 'GET') return sheet(await result(client.from('character_sheets').select('*').eq('id', match[1]).eq('user_id', uid).single()));
        if (method === 'PUT') return sheet(await result(client.from('character_sheets').update(sheetValues(body)).eq('id', match[1]).eq('user_id', uid).select('*').single()));
        if (method === 'DELETE') { await result(client.from('character_sheets').delete().eq('id', match[1]).eq('user_id', uid)); return null; }
      }
      if (path === '/api/grimoire' && method === 'GET') {
        const rows = await result(client.from('grimoire_entries').select('*').or(`is_standard.eq.true,owner_user_id.eq.${uid}`).order('created_at', { ascending: false }));
        return { entries: rows.map(row => ({ id: row.id, kind: row.kind, name: row.name, description: row.description, damage: row.damage, isStandard: row.is_standard })) };
      }
      if (path === '/api/grimoire' && method === 'POST') {
        return result(client.from('grimoire_entries').insert({ owner_user_id: uid, kind: body.kind === 'ability' ? 'ability' : 'spell', name: clean(body.name, 80) || 'Sem nome', description: clean(body.description, 5000), damage: clean(body.damage, 120), is_standard: false }).select('id').single());
      }
      if ((match = path.match(/^\/api\/grimoire\/([^/]+)$/))) {
        if (method === 'PUT') {
          await result(client.from('grimoire_entries').update({ name: clean(body.name, 80) || 'Sem nome', description: clean(body.description, 5000), damage: clean(body.damage, 120) }).eq('id', match[1]).eq('owner_user_id', uid).select('id').single()); return { ok: true };
        }
        if (method === 'DELETE') { await result(client.from('grimoire_entries').delete().eq('id', match[1]).eq('owner_user_id', uid)); return null; }
      }
      if (path === '/api/my/campaigns' && method === 'GET') {
        const [rows, memberships] = await Promise.all([
          result(client.from('campaigns').select('*').order('created_at', { ascending: false })),
          result(client.from('campaign_members').select('campaign_id,player_name').eq('user_id', uid))
        ]);
        return { campaigns: rows.map(row => ({ ...campaign(row), role: row.owner_user_id === uid ? 'master' : 'player', playerName: memberships.find(member => member.campaign_id === row.id)?.player_name || 'Mestre' })) };
      }
      if (path === '/api/campaigns' && method === 'POST') return result(client.rpc('create_campaign', { p_name: clean(body.name, 70) }));
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)$/)) && method === 'GET') return result(client.rpc('get_campaign', { p_code: decodeURIComponent(match[1]).toUpperCase() }));
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/join$/)) && method === 'POST') return result(client.rpc('join_campaign', { p_code: decodeURIComponent(match[1]).toUpperCase(), p_player_name: clean(body.playerName, 24) || 'Aventureiro' }));
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/members$/)) && method === 'GET') {
        const context = await members(decodeURIComponent(match[1]).toUpperCase());
        return { members: context.members, status: context.info.campaign.status, maxPlayers: 10 };
      }
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/(start|lobby)$/)) && method === 'POST') {
        await result(client.from('campaigns').update({ status: match[2] === 'start' ? 'session' : 'lobby' }).eq('code', decodeURIComponent(match[1]).toUpperCase()).eq('owner_user_id', uid).select('id').single()); return { ok: true };
      }
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/sheets(?:\/([^/]+))?(\/assign)?$/))) {
        const context = await masterContext(decodeURIComponent(match[1]).toUpperCase(), match[2]);
        if (!match[2] && method === 'GET') {
          const rows = await result(client.from('character_sheets').select('*').in('user_id', context.rows.map(row => row.user_id)).order('updated_at', { ascending: false }));
          const assignments = await result(client.from('campaign_sheet_assignments').select('sheet_id,assigned_user_id').eq('campaign_id', context.info.campaign.id));
          return { sheets: rows.map(row => ({ ...sheet(row), ownerName: context.members.find(member => member.id === row.user_id)?.displayName || '', assignedUserId: assignments.find(assignment => assignment.sheet_id === row.id)?.assigned_user_id || null })) };
        }
        if (match[2] && !match[3] && method === 'GET') return sheet(context.sheet);
        if (match[2] && method === 'PUT') {
          if (match[3]) await result(client.from('campaign_sheet_assignments').upsert({ campaign_id: context.info.campaign.id, sheet_id: match[2], assigned_user_id: body.userId || null }, { onConflict: 'campaign_id,sheet_id' }));
          else await result(client.from('character_sheets').update(sheetValues(body)).eq('id', match[2]).select('id').single());
          return { ok: true };
        }
      }
      if (path === '/api/friends' && method === 'GET') {
        const rows = await result(client.from('friendships').select('friend_user_id,status').eq('user_id', uid));
        const people = rows.length ? await result(client.from('profiles').select(profileColumns).in('id', rows.map(row => row.friend_user_id)).order('display_name')) : [];
        return { friends: people.map(row => ({ ...profile(row), status: rows.find(friend => friend.friend_user_id === row.id)?.status || 'accepted' })) };
      }
      if (path === '/api/friends' && method === 'POST') {
        const code = String(body.accountCode || '').trim();
        if (!/^\d{8}$/.test(code)) throw new Error('Informe o código de 8 números ou busque um jogador pelo nome.');
        return result(client.rpc('add_friend', { p_code: code }));
      }
      if (path === '/api/users/search' && method === 'GET') return result(client.rpc('search_players', { p_query: clean(parsed.searchParams.get('q'), 80) }));
      if (path === '/api/suggestions' && method === 'POST') {
        const text = clean(body.body, 5000);
        if (!text) throw new Error('Escreva sua sugestão.');
        await result(client.from('suggestions').insert({ user_id: uid, body: text })); return { ok: true };
      }
      if (path === '/api/home-feature' && method === 'PUT') {
        await admin();
        const value = { imageData: body.imageData, bookId: clean(body.bookId, 36) };
        await result(client.from('site_settings').upsert({ key: 'home_feature', value }, { onConflict: 'key' })); return value;
      }
      if (path === '/api/books' && method === 'POST') {
        await admin();
        const title = clean(body.title, 120);
        if (!title) throw new Error('Informe o título do livro.');
        const encoded = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.pdfData || '');
        if (!encoded || encoded[1].length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('Envie um PDF válido de até 20 MB.');
        let decoded;
        try { decoded = atob(encoded[1]); } catch { throw new Error('Envie um PDF válido de até 20 MB.'); }
        if (!decoded.startsWith('%PDF-') || decoded.length > 20 * 1024 * 1024) throw new Error('Envie um PDF válido de até 20 MB.');
        const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
        const id = crypto.randomUUID();
        const pdfPath = id + '.pdf';
        await result(client.storage.from('book-pdfs').upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: false }));
        try {
          await result(client.from('books').insert({ id, title, description: clean(body.description, 1000), cover_data: body.coverData || '', pdf_path: pdfPath }));
        } catch (error) {
          await client.storage.from('book-pdfs').remove([pdfPath]);
          throw error;
        }
        pdfPaths.set(id, pdfPath);
        return { id };
      }
      throw new Error('Esta função não está disponível. Atualize a página e tente novamente.');
    }
    return { client, request, currentUser, publicPdfUrl };
  };
})();
