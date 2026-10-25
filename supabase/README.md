# Banco do Grimório

Projeto: [Grimório](https://supabase.com/dashboard/project/fisrzivzjfehmdnoxfkx), PostgreSQL 17. A inspeção anterior à implantação encontrou zero tabelas de aplicação, zero contas, zero buckets e zero migrações. A migração `20261025200849_grimorio.sql` foi aplicada e seu nome local coincide com o histórico remoto, evitando reaplicação pela integração GitHub.

A migração complementar `20261025201458_preserve_sheet_portraits.sql` preserva o limite de retrato de 3 MB da ficha: o JSON aceita até 6 MiB para acomodar a imagem convertida em base64 e os demais campos. Ambas foram aplicadas e verificadas no projeto remoto.

## Estrutura

| Área | Tabelas / serviço |
| --- | --- |
| Cadastro, senha e sessão | Supabase Auth (`auth.users` e serviços internos) |
| Nome, foto e código permanente de 8 números | `profiles` |
| Fichas completas em JSON | `character_sheets` |
| Magias e habilidades | `grimoire_entries` |
| Campanhas, convite, tabuleiro e rolagens | `campaigns` |
| Participantes e nome na mesa | `campaign_members` |
| Anotações privadas do mestre | `campaign_notes` |
| Atribuição de fichas | `campaign_sheet_assignments` |
| Amigos por código ou nome | `friendships` |
| Chat público e privado por campanha | `campaign_messages` |
| Sugestões | `suggestions` |
| Catálogo e caminho do PDF | `books` |
| Anúncio da página inicial | `site_settings` |
| PDFs de até 20 MB | Bucket `book-pdfs` |

Todas as 12 tabelas da aplicação têm RLS. Visitantes podem ler catálogo, PDFs e anúncio. Jogadores gerenciam suas fichas e magias; mestres podem ler/editar fichas cujos donos participam de sua campanha. Mensagens privadas ficam restritas ao remetente e destinatário, ambos participantes da mesma campanha. Notas do mestre ficam separadas do estado compartilhado. Somente administradores escrevem no catálogo, no bucket e no anúncio.

O banco valida nomes, tipos, tamanhos, vínculos e permissões, mesmo se alguém chamar a API diretamente. Criação/entrada em campanhas, amizades, movimentos e rolagens usam funções transacionais. As funções privilegiadas ficam em `grimorio_private`; os sete pontos de entrada públicos são `SECURITY INVOKER`, com execução permitida apenas a usuários autenticados. A entrada em campanha usa bloqueio de linha para respeitar o limite de 10 pessoas.

`grimorio_private.admin_emails` reserva os endereços de administradores. Não há acesso pelo navegador, nem políticas que liberem suas linhas a usuários. O aviso informativo `RLS Enabled No Policy` nessa tabela é intencional: os papéis do navegador não possuem acesso. Endereços pessoais são configurados diretamente no banco e não entram no repositório. O cadastro só aceita o nome de exibição do metadata; `role` e o código de conta não podem ser alterados pelo cliente.

## Conectar a interface

`frontend.json` contém apenas URL e chave pública publishable. É apropriado para o navegador, e não contém senha do banco, chave secreta, token administrativo ou `service_role`. `npm run build` empacota o SDK oficial e configura as páginas para esse projeto. A chave pública sozinha não libera dados privados, que exigem sessão e RLS.

No Netlify mantenha a branch `main`, comando `npm run build` e publicação `dist`. Não use o fallback SPA: as rotas são páginas HTML físicas. Não defina `GRIMORIO_BACKEND=sqlite` no deploy Supabase.

O Supabase deve permitir a URL `https://scintillating-gumdrop-62c133.netlify.app/` em **Authentication → URL Configuration**, como Site URL e Redirect URL. Para a prévia local, adicione `http://localhost:3001/`. Esses valores estão em `config.toml`; a integração GitHub precisa ter a produção habilitada para aplicar `remotes.main`. Se essa etapa não ocorrer, ajuste no [painel de URLs](https://supabase.com/dashboard/project/fisrzivzjfehmdnoxfkx/auth/url-configuration). Veja a [configuração por branch](https://supabase.com/docs/guides/deployment/branching/configuration) e a [documentação de redirecionamento](https://supabase.com/docs/guides/auth/redirect-urls).

O cadastro informa quando é necessário confirmar o e-mail; não simula uma sessão antes da confirmação. Para aceitar cadastros do público, confira também o provedor de e-mail em Auth: o serviço SMTP padrão do Supabase tem restrições de destinatários e envio. Um provedor SMTP próprio deve ser configurado no painel para uso público, sem colocar suas credenciais no Git.

## Migrações e dados existentes

Novas alterações devem ser adicionadas como novas migrações. Não altere a migração já aplicada nem use reset no projeto remoto. Com a integração GitHub habilitada, novas migrações podem ser publicadas a partir de `main`. O histórico remoto já registra a migração inicial deste repositório.

O banco `grimorio.sqlite` permanece local e separado. Senhas e tokens locais não são sessões Supabase; contas e documentos não foram importados automaticamente. Uma importação posterior deve mapear os usuários para os IDs do Auth e transferir PDFs via Storage, sem publicar dados pessoais ou hashes no Git.

## Verificação

```powershell
npm.cmd test
npm.cmd run test:supabase:remote
npm.cmd run build
```

Os testes locais executam o SQL real em PostgreSQL/PGlite com representações dos schemas gerenciados do Supabase, verificando isolamento entre jogadores, permissões do mestre, metadados de cadastro, administração, códigos, chat, campanha e PDFs. Os testes do cliente e Realtime usam respostas simuladas. O teste remoto é somente leitura: verifica catálogo/anúncio públicos e bloqueio de perfis/campanhas sem autenticação. Ele não cria contas, não envia e-mails e não substitui a validação de cadastro/confirmação com o provedor de e-mail real.

Também foi executado um teste transacional no PostgreSQL hospedado: criação automática de perfil, campanha, entrada de jogador, ficha, rolagem e isolamento entre mestre/jogador/visitante. A transação foi revertida e a contagem final confirmou zero contas, campanhas ou fichas de teste persistidas.
