/* The build supplies the official SDK. Local Express pages keep their existing API. */
(() => {
  'use strict';
  window.createGrimorioSupabaseAdapter = function createGrimorioSupabaseAdapter(createClient, config) {
    const client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const pdfPaths = new Map();
    const profileColumns = 'id,username,display_name,avatar_data,account_code,role,created_at';
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
      if (response.error) {
        const error = new Error(response.error.code === '40001' ? 'Esta ficha foi alterada em outra janela. Confira as alterações antes de salvar novamente.' : messageFor(response.error));
        error.code = response.error.code;
        error.status = response.error.code === '40001' ? 409 : response.error.status;
        throw error;
      }
      return response.data;
    }
    function profile(row, email = '') {
      return { id: row.id, username: row.username, displayName: row.display_name, avatarData: row.avatar_data,
        accountCode: row.account_code, role: row.role, createdAt: row.created_at, email };
    }
    function sheet(row) {
      return { id: row.id, userId: row.user_id, name: row.name, data: row.data_json, folderId: row.folder_id || null, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at };
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
    function registration(body) {
      const username = clean(body.username, 32).toLowerCase();
      const birthDate = String(body.birthDate || '');
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Use de 3 a 24 letras, números ou _ no nome de usuário.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(birthDate)) || new Date(birthDate).toISOString().slice(0, 10) !== birthDate || birthDate < '1900-01-01' || birthDate > new Date().toISOString().slice(0, 10)) throw new Error('Informe uma data de nascimento válida.');
      return { username, birth_date: birthDate, display_name: username };
    }
    async function people(ids) {
      const unique = [...new Set(ids.filter(Boolean))];
      return unique.length ? await result(client.from('profiles').select(profileColumns).in('id', unique)) : [];
    }
    const person = (rows, id) => profile(rows.find(row => row.id === id) || { id, display_name: 'Aventureiro' });
    async function saveSheet(id, body) {
      const values = sheetValues(body);
      const row = await result(client.rpc('save_character_sheet', { p_sheet_id: id, p_name: values.name, p_data: values.data_json, p_expected_version: body.expectedVersion ?? null }));
      return row.sheet || (row.data_json ? sheet(row) : row);
    }
    async function uploadPdf(data, path) {
      const encoded = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data || '');
      if (!encoded || encoded[1].length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('Envie um PDF válido de até 20 MB.');
      let decoded;
      try { decoded = atob(encoded[1]); } catch { throw new Error('Envie um PDF válido de até 20 MB.'); }
      if (!decoded.startsWith('%PDF-') || decoded.length > 20 * 1024 * 1024) throw new Error('Envie um PDF válido de até 20 MB.');
      await result(client.storage.from('book-pdfs').upload(path, Uint8Array.from(decoded, character => character.charCodeAt(0)), { contentType: 'application/pdf', upsert: false }));
    }
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
    async function sheetContext(code, sheetId) {
      const context = await members(code);
      context.assignments = await result(client.from('campaign_sheet_assignments').select('sheet_id,assigned_user_id').eq('campaign_id', context.info.campaign.id));
      if (sheetId) {
        const row = await result(client.from('character_sheets').select('*').eq('id', sheetId).single());
        const uid = (await session()).user.id;
        const belongs = context.rows.some(member => member.user_id === row.user_id);
        const assigned = context.assignments.some(item => item.sheet_id === row.id && item.assigned_user_id === uid);
        if (!belongs || (context.info.role !== 'master' && row.user_id !== uid && !assigned)) throw new Error('Esta ficha não está disponível nesta campanha.');
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
          ? client.auth.signUp({ ...credentials, options: { emailRedirectTo: window.location.origin + '/', data: registration(body) } })
          : client.auth.signInWithPassword(credentials));
        if (!data.session) return { requiresConfirmation: true, email: credentials.email };
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
      if (path === '/api/site-content' && method === 'GET') {
        const row = await result(client.from('site_settings').select('value').eq('key', 'site_content').maybeSingle());
        return row?.value || {};
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
        return sheet(await result(client.from('character_sheets').insert({ user_id: uid, folder_id: body.folderId || null, ...sheetValues(body) }).select('*').single()));
      }
      if (path === '/api/sheet-folders' && method === 'GET') {
        const rows = await result(client.from('sheet_folders').select('*').eq('user_id', uid).order('name'));
        return { folders: rows.map(row => ({ id: row.id, name: row.name, parentId: row.parent_id, createdAt: row.created_at })) };
      }
      if (path === '/api/sheet-folders' && method === 'POST') {
        const row = await result(client.from('sheet_folders').insert({ user_id: uid, name: clean(body.name, 70), parent_id: body.parentId || null }).select('*').single());
        return { id: row.id, name: row.name, parentId: row.parent_id };
      }
      if ((match = path.match(/^\/api\/sheet-folders\/([^/]+)$/))) {
        if (method === 'DELETE') { await result(client.from('sheet_folders').delete().eq('id', match[1]).eq('user_id', uid)); return null; }
        if (method === 'PUT') {
          const values = {};
          if ('name' in body) values.name = clean(body.name, 70);
          if ('parentId' in body) values.parent_id = body.parentId || null;
          const row = await result(client.from('sheet_folders').update(values).eq('id', match[1]).eq('user_id', uid).select('*').single());
          return { id: row.id, name: row.name, parentId: row.parent_id };
        }
      }
      if ((match = path.match(/^\/api\/sheets\/([^/]+)\/folder$/)) && method === 'PUT') {
        return sheet(await result(client.from('character_sheets').update({ folder_id: body.folderId || null }).eq('id', match[1]).eq('user_id', uid).select('*').single()));
      }
      if ((match = path.match(/^\/api\/sheets\/([^/]+)$/))) {
        if (method === 'GET') return sheet(await result(client.from('character_sheets').select('*').eq('id', match[1]).eq('user_id', uid).single()));
        if (method === 'PUT') {
          await result(client.from('character_sheets').select('id').eq('id', match[1]).eq('user_id', uid).single());
          return saveSheet(match[1], body);
        }
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
        const context = await sheetContext(decodeURIComponent(match[1]).toUpperCase(), match[2]);
        if (!match[2] && method === 'GET') {
          const rows = await result(client.from('character_sheets').select('*').in('user_id', context.rows.map(row => row.user_id)).order('updated_at', { ascending: false }));
          const assignments = context.assignments;
          return { sheets: rows.filter(row => context.info.role === 'master' || row.user_id === uid || assignments.some(item => item.sheet_id === row.id && item.assigned_user_id === uid)).map(row => ({ ...sheet(row), ownerName: context.members.find(member => member.id === row.user_id)?.displayName || '', assignedUserId: assignments.find(assignment => assignment.sheet_id === row.id)?.assigned_user_id || null })) };
        }
        if (match[2] && !match[3] && method === 'GET') return sheet(context.sheet);
        if (match[2] && method === 'PUT') {
          if (match[3]) {
            if (context.info.role !== 'master') throw new Error('Somente o mestre pode atribuir fichas.');
            await result(client.from('campaign_sheet_assignments').upsert({ campaign_id: context.info.campaign.id, sheet_id: match[2], assigned_user_id: body.userId || null }, { onConflict: 'campaign_id,sheet_id' }));
          } else return saveSheet(match[2], body);
          return { ok: true };
        }
      }
      if (path === '/api/friends' && method === 'GET') {
        const rows = await result(client.from('friendships').select('friend_user_id,status').eq('user_id', uid).eq('status', 'accepted'));
        const requests = await result(client.from('friend_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }));
        const profiles = await people([...rows.map(row => row.friend_user_id), ...requests.flatMap(row => [row.sender_user_id, row.recipient_user_id])]);
        const mapRequest = row => ({ id: row.id, status: row.status, createdAt: row.created_at, person: person(profiles, row.sender_user_id === uid ? row.recipient_user_id : row.sender_user_id) });
        return { friends: rows.map(row => ({ ...person(profiles, row.friend_user_id), status: 'accepted' })), incomingRequests: requests.filter(row => row.recipient_user_id === uid).map(mapRequest), outgoingRequests: requests.filter(row => row.sender_user_id === uid).map(mapRequest) };
      }
      if (path === '/api/friends' && method === 'POST') {
        const code = String(body.accountCode || '').trim();
        if (!/^\d{8}$/.test(code)) throw new Error('Informe o código de 8 números ou busque um jogador pelo nome.');
        return result(client.rpc('add_friend', { p_code: code }));
      }
      if (path === '/api/users/search' && method === 'GET') return result(client.rpc('search_players', { p_query: clean(parsed.searchParams.get('q'), 80) }));
      if ((match = path.match(/^\/api\/friend-requests\/([^/]+)(?:\/(accept|decline))?$/))) {
        if (method === 'DELETE' || method === 'POST' && match[2]) return result(client.rpc('respond_friend_request', { p_request_id: match[1], p_action: method === 'DELETE' ? 'cancel' : match[2] }));
      }
      if ((match = path.match(/^\/api\/friends\/([^/]+)$/)) && method === 'DELETE') return result(client.rpc('remove_friend', { p_user_id: match[1] }));
      if (path === '/api/campaign-invites' && method === 'GET' || (match = path.match(/^\/api\/campaigns\/([^/]+)\/invites$/)) && method === 'GET') {
        let query = client.from('campaign_invitations').select('*').eq('status', 'pending');
        if (match) { const context = await members(match[1].toUpperCase()); if (context.info.role !== 'master') throw new Error('Somente o mestre pode ver os convites enviados.'); query = query.eq('campaign_id', context.info.campaign.id); }
        else query = query.eq('recipient_user_id', uid);
        const invites = await result(query.order('created_at', { ascending: false }));
        const profiles = await people(invites.flatMap(row => [row.inviter_user_id, row.recipient_user_id]));
        const campaigns = invites.length ? await result(client.rpc('list_campaign_invites')) : { invites: [] };
        // The RPC includes invite previews without granting table access to non-members.
        return { invites: invites.map(row => ({ id: row.id, status: row.status, createdAt: row.created_at, campaign: campaigns.invites.find(item => item.id === row.id)?.campaign || { code: row.campaign_code, name: 'Campanha' }, inviter: person(profiles, row.inviter_user_id), person: person(profiles, row.recipient_user_id) })) };
      }
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/invites$/)) && method === 'POST') return result(client.rpc('invite_campaign_player', { p_code: match[1].toUpperCase(), p_user_id: body.userId }));
      if ((match = path.match(/^\/api\/campaign-invites\/([^/]+)\/(accept|decline)$/)) && method === 'POST') return result(client.rpc('respond_campaign_invite', { p_invite_id: match[1], p_action: match[2] }));
      if ((match = path.match(/^\/api\/campaigns\/([^/]+)\/rolls$/)) && method === 'GET') {
        const context = await members(match[1].toUpperCase());
        let query = client.from('campaign_rolls').select('*').eq('campaign_id', context.info.campaign.id);
        const before=parsed.searchParams.get('before'),beforeId=parsed.searchParams.get('beforeId');
        if(before&&beforeId&&/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(before)&&/^[a-f0-9-]{36}$/i.test(beforeId))query=query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`);
        const rows = await result(query.order('created_at', { ascending: false }).order('id',{ascending:false}).limit(200));
        return { rolls: rows.map(row => row.result || row.roll || { id: row.id, player: row.player_name, characterName: row.character_name, label: row.label, sides: row.sides, value: row.value, modifier: row.modifier, total: row.total, seed: row.animation_seed, at: row.created_at, createdAt: row.created_at }) };
      }
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
      if (path === '/api/site-content' && method === 'PUT') {
        await admin();
        const value = { heroTitle: clean(body.heroTitle, 100), heroBody: clean(body.heroBody, 600), aboutTitle: clean(body.aboutTitle, 120), aboutBody: clean(body.aboutBody, 2000), supportText: clean(body.supportText, 1000), supportUrl: clean(body.supportUrl, 500) };
        if (value.supportUrl && !/^https:\/\//i.test(value.supportUrl)) throw new Error('O link da vaquinha deve começar com https://.');
        await result(client.from('site_settings').upsert({ key: 'site_content', value }, { onConflict: 'key' }));
        return value;
      }
      if (path === '/api/admin/users' && method === 'GET') {
        await admin();
        return result(client.rpc('admin_find_account', { p_email: clean(parsed.searchParams.get('email'), 320).toLowerCase() }));
      }
      if (path === '/api/admin/admins' && method === 'POST') {
        await admin();
        return result(client.rpc('admin_grant_access', { p_email: clean(body.email, 320).toLowerCase(), p_account_code: String(body.accountCode || '') }));
      }
      if (path === '/api/admin/suggestions' && method === 'GET') {
        await admin();
        const rows = await result(client.from('suggestions').select('id,user_id,body,created_at').order('created_at', { ascending: false }).limit(100));
        const profiles = await people(rows.map(row => row.user_id));
        return { suggestions: rows.map(row => ({ id: row.id, body: row.body, createdAt: row.created_at, person: person(profiles, row.user_id) })) };
      }
      if ((match = path.match(/^\/api\/books\/([^/]+)$/)) && ['PUT', 'DELETE'].includes(method)) {
        await admin();
        const old = await result(client.from('books').select(bookColumns).eq('id', match[1]).single());
        if (method === 'DELETE') {
          await result(client.from('books').delete().eq('id', old.id));
          const removal = await client.storage.from('book-pdfs').remove([old.pdf_path]);
          pdfPaths.delete(old.id);
          return { ok: true, warning: removal.error ? 'Livro removido. O arquivo antigo ainda precisa ser removido do armazenamento.' : '' };
        }
        const title = clean(body.title, 120);
        if (!title) throw new Error('Informe o título do livro.');
        const values = { title, description: clean(body.description, 1000), cover_data: body.coverData ?? old.cover_data };
        if (body.pdfData) { values.pdf_path = old.id + '_' + crypto.randomUUID() + '.pdf'; await uploadPdf(body.pdfData, values.pdf_path); }
        try { await result(client.from('books').update(values).eq('id', old.id).select('id').single()); }
        catch (error) { if (values.pdf_path) await client.storage.from('book-pdfs').remove([values.pdf_path]); throw error; }
        let warning = '';
        if (values.pdf_path) {
          pdfPaths.set(old.id, values.pdf_path);
          const cleanup = await client.storage.from('book-pdfs').remove([old.pdf_path]);
          if (cleanup.error) warning = 'Livro atualizado. O PDF anterior ainda precisa ser removido do armazenamento.';
        }
        return { id: old.id, warning };
      }
      if (path === '/api/books' && method === 'POST') {
        await admin();
        const title = clean(body.title, 120);
        if (!title) throw new Error('Informe o título do livro.');
        const id = crypto.randomUUID();
        const pdfPath = id + '.pdf';
        await uploadPdf(body.pdfData, pdfPath);
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
