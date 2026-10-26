# Grimório

Plataforma de RPG criada por amigos para reunir personagens, campanhas, livros e uma mesa compartilhada em tempo real. É um projeto amador, sem fins lucrativos. A página inicial apresenta o projeto e reserva um espaço para uma futura vaquinha de apoio.

A publicação usa Supabase Auth, PostgreSQL, Storage e Realtime. O modo local usa Node.js, Express, SQLite e Socket.IO. A interface é formada por páginas HTML e JavaScript em `public/`; não usa React, Vite ou React Router.

## Executar localmente

Use Node.js 22 ou superior:

```powershell
npm.cmd install
npm.cmd start
```

Abra http://localhost:3000. No PowerShell, `npm.cmd` também funciona quando a política local bloqueia `npm.ps1`. O banco persistente é `grimorio.sqlite`, na raiz do projeto. Faça backup com o servidor parado ou com uma ferramenta compatível com SQLite em modo WAL.

Para reiniciar o servidor quando o código mudar, use `npm.cmd run dev`. Alterações no servidor não são carregadas por um processo antigo iniciado com `npm.cmd start`.

## Cadastro, perfil e acesso

**Criar conta** abre `/cadastro.html`, uma página separada do login, com nome de usuário, e-mail, senha e nascimento. O nome de usuário é único, sem distinção entre maiúsculas e minúsculas: aceita de 3 a 24 letras, números ou sublinhados. O nome de exibição pode ser diferente e pode ser alterado em **Editar perfil**. A data de nascimento fica fora do diretório público de jogadores.

No Supabase, a confirmação por e-mail permanece habilitada. Após cadastrar, a página orienta a confirmar o endereço; ela não apresenta uma sessão inexistente. Quando o serviço retorna uma sessão válida, o cadastro encaminha para o início com a conta autenticada. O modo SQLite local cria uma sessão diretamente, sem serviço de envio de e-mail.

Cada conta possui um código único e permanente de 8 números. O perfil mostra o nome de usuário e o código como texto, com um botão para copiar o código. É possível editar o nome de exibição, selecionar uma foto PNG/JPG/WEBP de até 3 MB, conferir a prévia e remover a foto. Os nomes de usuário e códigos não são campos editáveis.

Ao abrir Amigos, Campanhas ou Fichas sem sessão válida, o login aparece automaticamente. Depois de entrar, o site retorna à página solicitada, preservando o contexto do convite. Abrir a página inicial normalmente não exibe o login.

## Amigos e convites de campanha

Em **Amigos**, busque pelo nome de usuário, nome de exibição ou código da conta. A busca não divulga e-mails. Enviar uma solicitação não cria uma amizade imediatamente: a outra pessoa precisa aceitá-la. A página separa solicitações recebidas e enviadas, permite aceitar, recusar ou cancelar pedidos e permite desfazer amizades.

Em **Campanhas**, há busca, filtros por papel e contagem de campanhas. O mestre pode abrir **Participantes e convites** diretamente no cartão da campanha ou usar **Convidar amigos** no lobby. Os convites são enviados a amigos e aparecem na página de campanhas do destinatário. Aceitar adiciona a pessoa ao grupo, sem exigir que ela entre no lobby naquele momento.

O lobby distingue participantes cadastrados de pessoas conectadas: os indicadores e lugares ao redor da mesa acompanham a presença em tempo real. A campanha admite até 10 participantes, incluindo o mestre. O convite por código/link também continua disponível.

## Fichas, biblioteca e mesa

A biblioteca de fichas permite criar pastas e subpastas, renomear e organizar fichas por campanha. Pastas pertencem à conta que as criou; ciclos de pastas e vínculos com pastas de outra pessoa são recusados. Remover uma pasta preserva as fichas e libera seus vínculos com ela.

Na sessão, o mestre tem uma barra lateral com **Fichas players** e **Minhas fichas**. Ele pode abrir as fichas dos participantes, consultar sua própria biblioteca organizada em pastas e atribuir suas fichas a jogadores. A visão do jogador apresenta suas próprias fichas e as que lhe foram atribuídas; não libera as fichas dos outros jogadores ou a biblioteca privada do mestre.

As fichas abrem em janelas abaixo do tabuleiro. É possível movê-las, redimensioná-las, minimizar e restaurar sua posição para acompanhar ficha, dados e mapa ao mesmo tempo. As alterações na mesa são salvas e propagadas aos participantes autorizados. O controle de versão detecta edições simultâneas e evita sobrescrever silenciosamente uma versão mais recente; a interface informa quando é necessário recarregar ou revisar uma alteração.

Anotações do mestre ficam privadas. O chat permite mensagens para o grupo e mensagens privadas entre participantes da mesma campanha.

## Dados compartilhados

Testes e rolagens feitos na ficha conectada à campanha aparecem também no tabuleiro e no histórico. Todos recebem o mesmo resultado, bônus, total e identificação da rolagem. Por exemplo: `D20: 16 · Bônus: +4 · Total: 20`.

O D20 usa o modelo fornecido pelo usuário em `public/assets/grimorio-d20.glb`, renderizado com Three.js. Cannon ES simula queda, rotação, colisões e quique com uma semente compartilhada. O resultado é sorteado no servidor; a animação apresenta esse resultado na pose final. Assim, a física visual não permite que cada navegador escolha um resultado diferente. Os demais dados usam formas geradas pela aplicação.

O histórico de campanha é persistente e oferece carregamento de rolagens anteriores. Há tratamento de mensagens duplicadas, fila de animações, respeito à preferência de movimento reduzido e apresentação textual do resultado se o navegador não puder usar WebGL.

`scripts/build-dice.mjs` gera `public/dice-runtime.js`. Esse arquivo é um artefato de build; os comandos de início, teste e build preparam o pacote a partir de `client/dice-renderer.mjs`.

## Livros, administração e página inicial

O catálogo e a leitura de PDFs são públicos. Em **Livros**, administradores podem publicar título, descrição, PDF de até 20 MB e capa PNG/JPG/WEBP de até 3 MB. **Ler livro** abre o visualizador do navegador dentro da plataforma, com alternativas para abrir em outra aba ou baixar. `/livros.html?book=ID` abre o livro correspondente.

O link **Administração** aparece para contas com papel `admin`. O painel `/admin.html` permite:

- Buscar uma conta existente pelo e-mail, conferir o perfil e código e conceder acesso de administrador.
- Editar títulos, descrições e capas dos livros, substituir PDFs e excluir publicações.
- Alterar os textos da página inicial, a apresentação do projeto e o texto/link da vaquinha.
- Consultar sugestões da comunidade e acessar a edição do anúncio.

As permissões são verificadas no servidor e no banco. No Supabase, cadastrar um e-mail ou enviar metadados de perfil não concede administração: a promoção é uma ação explícita de um administrador sobre uma conta existente. O primeiro administrador precisa ser definido pelo responsável pelo projeto, em um contexto confiável do banco. Administradores existentes são preservados.

No modo SQLite, o operador pode usar `ADMIN_EMAIL` para configurar o administrador local:

```powershell
$env:ADMIN_EMAIL = "seu-email@exemplo.com"
npm.cmd start
```

Essa configuração é exclusiva do servidor local; não configura o Supabase. O papel fica persistido no SQLite e remover a variável não revoga um acesso já concedido.

A arte padrão do anúncio fica em `public/assets/grimorio-book.png`. **Editar anúncio** permite trocar a imagem e associar um livro do catálogo; sem associação, o anúncio abre o catálogo. Os efeitos ao passar o cursor respeitam movimento reduzido. Conteúdo e anúncio são persistidos no backend ativo. A vaquinha aparece como **em preparação** enquanto nenhum link HTTPS tiver sido configurado; o site não processa pagamentos.

## Publicar no Netlify

```powershell
npm.cmd run build
```

O build gera `dist/` a partir de `public/`, incluindo páginas, estilos, imagens, modelo do dado e os pacotes do navegador. Não inclui `server.js`, SQLite, credenciais ou `node_modules`. O arquivo inicial fica em `dist/index.html`; `dist` permanece fora do Git.

O `netlify.toml` define:

| Configuração | Valor |
| --- | --- |
| Repositório / branch | `iTzBiel1227/grimorio` / `main` |
| Base directory | Raiz do repositório (`.`) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node.js | `22` |
| Pretty URLs | Desativado, preservando os caminhos `.html` |

Após enviar para `main`, aguarde o deploy automático ou use **Deploys → Trigger deploy → Deploy site**. Em publicação manual, envie a pasta `dist` gerada. Confira que `index.html`, `cadastro.html`, `amigos.html`, `campanha.html`, `ficha.html`, `livros.html` e `assets/` estão na raiz publicada.

As rotas são arquivos HTML reais, como `/amigos.html`. Não há `vite.config` nem roteador SPA, e não é necessário adicionar `/* /index.html 200` a `public/_redirects`. Publicar a raiz do repositório, em vez de `dist`, pode causar erro 404 por ausência de `index.html` naquele diretório.

### Supabase na publicação

`supabase/frontend.json` contém a URL e a chave pública publishable do projeto Grimório (`fisrzivzjfehmdnoxfkx`). O build empacota o SDK oficial em `dist/supabase-runtime.js` e o carrega antes dos scripts das páginas. Auth gerencia contas; PostgreSQL guarda os dados; Storage guarda PDFs; Realtime sincroniza presença, fichas, rolagens e chat. Esse modo não precisa de `server.js` no Netlify.

`SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`, quando definidas juntas, substituem a configuração pública versionada. O build rejeita chaves secretas e `service_role`. A autorização depende de sessão, RLS e funções do banco.

Para visualizar a publicação localmente:

```powershell
npm.cmd run build
npm.cmd run preview
```

Abra http://localhost:3001. Esse build usa o Supabase configurado, inclusive seus dados reais. `npm.cmd start` executa o modo SQLite separado. Para gerar explicitamente a interface local, defina `GRIMORIO_BACKEND=sqlite` antes do build.

Consulte [modelo, permissões e configuração do Supabase](supabase/README.md). Em **Authentication → URL Configuration**, mantenha `https://scintillating-gumdrop-62c133.netlify.app/` como Site URL e Redirect URL. A confirmação de cadastro depende também do provedor de e-mail configurado no Supabase.

Contas, documentos e senhas do SQLite não foram importados automaticamente para o Supabase nem apagados. Os dois modos possuem dados e sessões separados.

## Verificação

```powershell
npm.cmd test
npm.cmd run test:api
npm.cmd run test:content
npm.cmd run test:friends
npm.cmd run test:supabase:remote
npm.cmd run build
```

Os testes de API usam SQLite temporário. Os testes SQL executam as migrações em PostgreSQL/PGlite, verificando autenticação, permissões, consentimento de amizade, convites, fichas, pastas, administração e histórico. O teste remoto do Supabase é somente leitura e não envia e-mails.

Para os testes de navegador, instale o Chromium uma vez e execute:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

O teste E2E inicia um servidor com SQLite temporário e usa contextos separados do Chromium para simular mestre e jogador. Exercita solicitações de amizade, convites, presença, pastas, acesso por papel, edição compartilhada de fichas, animação do dado, histórico, administração e layout móvel. Capturas ficam em `.tmp/screenshots/`, fora do Git. Esses testes locais não substituem a verificação do envio e confirmação de e-mail no Supabase hospedado.

No GitHub Actions, `GRIMORIO_TEST_BROWSER=chrome` usa o [Chrome já instalado no ambiente Ubuntu](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md), evitando reinstalar navegador e dependências a cada envio. Localmente, o padrão continua sendo o Chromium instalado pelo Playwright.

## GitHub e atualizações

O repositório público é `iTzBiel1227/grimorio`, branch `main`. Envie alterações concluídas com:

```powershell
npm.cmd run sync -- "Descreve a melhoria realizada"
```

O comando verifica o destino e o estado remoto, executa verificações, cria um commit quando necessário e envia ao GitHub. Divergências, falhas de testes ou falta de autenticação interrompem o envio. A sincronização ocorre ao finalizar uma alteração validada; não há envio contínuo de cada arquivo durante a edição. `AGENTS.md` registra a autorização e esse fluxo de trabalho.

O `.gitignore` exclui bancos de usuários, sessões, uploads, credenciais, dependências e artefatos locais. O GitHub guarda o código; não é um backup das contas ou dos documentos cadastrados. Consulte **Actions** para acompanhar os testes dos commits enviados.
