# Grimório

Plataforma de RPG em Node.js, Express, SQLite e Socket.IO, com contas, perfis, campanhas, lobby, fichas, biblioteca de magias e catálogo de livros.

## Executar

Use Node.js 22 ou superior e instale as dependências:

```powershell
npm.cmd install
npm.cmd start
```

Acesse http://localhost:3000. No PowerShell, `npm.cmd` também funciona quando a política local bloqueia `npm.ps1`. O banco persistente é `grimorio.sqlite`, na raiz do projeto. Faça backup do banco com o servidor parado, ou use uma ferramenta compatível com SQLite em modo WAL.

## Publicar a interface no Netlify

Este repositório usa **Express com páginas HTML em `public/`**, SQLite e Socket.IO. Não usa React, Vite ou React Router; não existe `vite.config`. As rotas são arquivos como `/amigos.html`, `/campanha.html` e `/livros.html`, servidos localmente por `express.static`. O servidor também possui um retorno para a página inicial em caminhos desconhecidos, mas isso não transforma a interface em uma SPA.

Antes desta configuração, não havia comando `build` nem pasta `dist`. Publicar a raiz do repositório, onde não há `index.html`, ou apontar para uma `dist` inexistente causa o erro de página não encontrada. Sem a URL e os logs do deploy, a configuração efetivamente usada no Netlify precisa ser conferida no painel.

Para gerar os arquivos da interface:

```powershell
npm.cmd run build
```

O build recria `dist/` a partir de `public/`, preservando as páginas, os scripts, os estilos e a arte do livro. Não inclui `server.js`, o banco, credenciais ou `node_modules`. O arquivo inicial fica diretamente em `dist/index.html`. `dist` é gerada automaticamente e permanece fora do Git.

O `netlify.toml` na raiz registra estas configurações:

| Configuração | Valor |
| --- | --- |
| Repositório / branch | `iTzBiel1227/grimorio` / `main` |
| Base directory | Raiz do repositório (`.`) |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node.js | `22` |
| Pretty URLs | Desativado, preservando os caminhos `.html` e o retorno após login |

No Netlify, confira que o projeto está conectado a esse repositório e branch. Após o push, aguarde o deploy automático ou use **Deploys → Trigger deploy → Deploy site**. No deploy concluído, abra o **Deploy File Explorer** e confirme que `index.html`, `amigos.html`, `campanha.html`, `ficha.html`, `livros.html` e `assets/` estão na raiz publicada. Teste também abrir e atualizar `/livros.html` diretamente. Em publicação manual por upload, envie a pasta `dist` gerada, não a raiz do projeto.

Não é necessário criar `public/_redirects` com `/* /index.html 200`: essa regra atende SPAs com roteador no navegador. Aqui, cada rota já possui seu HTML; a regra também esconderia erros de `/api/*` e `/socket.io/*`, devolvendo a página inicial onde o cliente espera JSON ou JavaScript. Consulte o [guia oficial de erro 404](https://docs.netlify.com/resources/troubleshooting/page-not-found-error-guide/) e a [configuração por arquivo](https://docs.netlify.com/build/configure-builds/file-based-configuration/).

### Backend necessário para as funcionalidades

**Esse deploy no Netlify publica a interface estática; não inicia `server.js`.** Login, perfis, amizades, campanhas, fichas, PDFs e sessões em tempo real dependem das rotas `/api/*`, do SQLite e do Socket.IO. Apenas criar `dist` ou adicionar redirects não coloca esses serviços em execução. As funcionalidades e o servidor existentes foram preservados.

Para publicar a plataforma completa como está, o servidor precisa de uma hospedagem que execute `npm ci` e `npm start`, mantenha o processo Node ativo, permita Socket.IO/WebSockets e preserve `grimorio.sqlite` em armazenamento persistente. O próprio Express pode servir a interface e a API no mesmo domínio. Para manter a interface no Netlify, será necessário configurar a conexão com um backend externo já hospedado, incluindo API, PDFs e Socket.IO; esta versão ainda usa requisições para o mesmo domínio. Não foi configurado um destino fictício nem uma migração para Functions, pois isso exigiria adaptar a persistência e as sessões em tempo real.

## Administradores

Somente administradores podem publicar livros e alterar o anúncio da página inicial. Para definir o administrador, inicie o servidor com o e-mail da conta desejada:

```powershell
$env:ADMIN_EMAIL = "seu-email@exemplo.com"
npm.cmd start
```

A configuração funciona tanto para uma conta existente quanto para uma conta que será cadastrada com esse e-mail. O papel de administrador é persistido no banco. Trocar ou remover a variável não revoga administradores anteriores. Não existe promoção de usuário pela interface pública.

## Livros e leitor

Na aba **Livros**, o administrador encontra **Adicionar livro**. Informe título, descrição opcional, PDF de até 20 MB e, se desejar, uma capa PNG/JPG/WEBP de até 3 MB. O catálogo e a leitura são públicos.

**Ler livro** abre um leitor dentro da plataforma, com o visualizador PDF do navegador, além de opções para abrir em outra aba ou baixar. Em navegadores que não exibem PDFs incorporados, use essas opções. Um link `/livros.html?book=ID` abre diretamente o livro correspondente.

## Perfil

Após fazer login, clique no nome/foto no canto superior direito. É possível alterar o nome de exibição, selecionar e pré-visualizar uma foto, remover a foto e salvar ou cancelar. Nome e imagem ficam associados à conta, inclusive depois de sair e entrar novamente.

## Anúncio da página inicial

A arte padrão está em `public/assets/grimorio-book.png`. Foi preparada com a ferramenta integrada de imagens a partir da imagem enviada pelo usuário, preservando composição, livro, cores e cenário, com ajustes de clareza e iluminação. O efeito de zoom e brilho é feito em CSS e respeita a preferência de movimento reduzido.

O administrador pode clicar em **Editar anúncio**, anexar outra imagem de até 3 MB e escolher um livro do catálogo como destino. A configuração é compartilhada e persistida no SQLite. Sem livro selecionado, o anúncio abre o catálogo.

Prompt usado na edição da arte: “Prepare this exact attached book image as a polished square web promotional asset. Preserve the original book, cover title, intricate cover artwork, red and black colors, candles, setting and full composition as closely as possible. Only subtly improve clarity and balance the dark lighting for website display. Do not add any text, logos, objects or borders. Output square full image; the book must remain fully visible.”

## Verificação

```powershell
npm.cmd test
npm.cmd run test:api
npm.cmd run test:content
```

Os testes de API usam SQLite temporário, sem alterar contas ou campanhas reais. A análise geral e as pendências estão em `ANALISE_PROJETO.md`. O projeto ainda tem pendências de autorização nas sessões em tempo real e no acesso às fichas por campanha; elas não fazem parte dos fluxos de catálogo/perfil desta atualização.
## Amigos, contas e acesso

Cada conta possui um código único e permanente de 8 números, visível em **Amigos** e **Editar perfil**. As contas existentes recebem o código automaticamente ao iniciar esta versão. É possível buscar jogadores pelo nome de exibição ou pelo código e confirmar a conta pelo código antes de adicionar. A busca não divulga e-mails.

Ao abrir Amigos, Campanhas ou Fichas sem uma sessão válida, o login aparece automaticamente. Depois de entrar, a navegação retorna à página solicitada, preservando o convite/contexto da URL. Abrir a página inicial normalmente continua sem exibir o login.

Campanhas oferece busca, filtros por papel, contagem de mundos e atalhos para lobby/sessão. A ficha usa colunas fluidas, reorganizadas conforme a largura da tela, e o painel História tem no máximo 480 px de largura.

Para testar migração de códigos, pesquisa e amizades: `npm.cmd run test:friends`.

Durante desenvolvimento, use `npm.cmd run dev` para reiniciar o servidor quando o código mudar. Alterações apenas no navegador não recarregam o código de um processo antigo iniciado com `npm.cmd start`.
## GitHub e próximas atualizações

O destino deste projeto é o repositório público `iTzBiel1227/grimorio`, na branch `main`. Após a publicação inicial, envie alterações concluídas com:

```powershell
npm.cmd run sync -- "Descreve a melhoria realizada"
```

O comando verifica o destino, consulta o estado remoto, executa os testes, cria um commit quando há alterações e envia para o GitHub. Se houver divergência, conflito, erro de teste ou falta de autenticação, ele interrompe o envio. Não há um serviço enviando cada arquivo enquanto você digita: a sincronização ocorre ao finalizar uma alteração validada. As orientações em `AGENTS.md` registram esse fluxo para os próximos trabalhos neste projeto.

O `.gitignore` exclui bancos com dados de usuários, arquivos de sessão, uploads, credenciais e dependências locais. O GitHub armazena o código; iniciar o projeto em outro computador cria um banco vazio. Para acompanhar o estado dos testes do código enviado, consulte a aba **Actions** do repositório.
