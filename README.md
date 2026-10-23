# Grimório

Plataforma de RPG em Node.js, Express, SQLite e Socket.IO, com contas, perfis, campanhas, lobby, fichas, biblioteca de magias e catálogo de livros.

## Executar

Use Node.js 22 ou superior e instale as dependências:

```powershell
npm.cmd install
npm.cmd start
```

Acesse http://localhost:3000. No PowerShell, `npm.cmd` também funciona quando a política local bloqueia `npm.ps1`. O banco persistente é `grimorio.sqlite`, na raiz do projeto. Faça backup do banco com o servidor parado, ou use uma ferramenta compatível com SQLite em modo WAL.

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
