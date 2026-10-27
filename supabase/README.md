# Banco do Grimório

Projeto: [Grimório](https://supabase.com/dashboard/project/fisrzivzjfehmdnoxfkx), PostgreSQL 17. A inspeção anterior à implantação inicial encontrou o schema de aplicação vazio. O projeto usa migrações versionadas em `supabase/migrations/`; alterações novas devem ser acrescentadas ao histórico, preservando os dados existentes.

A migração inicial `grimorio` cria contas de perfil, fichas, conteúdo e campanhas. `preserve_sheet_portraits` mantém o retrato de até 3 MB dentro de um JSON de ficha limitado a 6 MiB. A migração `community_campaigns` acrescenta identidade de usuário, consentimento de amizade, convites, pastas, colaboração nas fichas, histórico de dados e administração explícita.

`profile_and_public_grimoire` acrescenta banner e biografia ao perfil, imagens aos poderes e leitura anônima da biblioteca pública. Publicações são criadas apenas por administradores; criações privadas só podem ser lidas e alteradas pelo dono, inclusive quando outra conta é administradora. O campo de publicação não pode ser alterado após a criação. As imagens são validadas como PNG/JPG/WebP de até 3 MiB.

## Estrutura

| Área | Tabelas / serviço |
| --- | --- |
| Cadastro, confirmação de e-mail, senha e sessão | Supabase Auth |
| Nome de usuário único, nome de exibição, foto, banner, biografia e código de 8 números | `profiles` |
| Nascimento privado da conta | `account_details` |
| Fichas em JSON, pasta e versão de edição | `character_sheets` |
| Pastas e subpastas da biblioteca | `sheet_folders` |
| Sinalização de versões para sincronizar fichas | `character_sheet_versions` |
| Magias e habilidades | `grimoire_entries` |
| Campanhas, tabuleiro e últimas rolagens | `campaigns` |
| Participantes e nome na mesa | `campaign_members` |
| Convites de amigos para campanhas | `campaign_invitations` |
| Anotações privadas do mestre | `campaign_notes` |
| Fichas atribuídas a jogadores | `campaign_sheet_assignments` |
| Solicitações de amizade | `friend_requests` |
| Amizades aceitas | `friendships` |
| Histórico persistente das rolagens | `campaign_rolls` |
| Chat público e privado por campanha | `campaign_messages` |
| Sugestões | `suggestions` |
| Catálogo e caminho do PDF | `books` |
| Textos da página inicial, vaquinha e anúncio | `site_settings` |
| PDFs de até 20 MB | Bucket `book-pdfs` |

As 18 tabelas públicas de aplicação têm RLS. Visitantes podem ler o catálogo, os PDFs, os poderes publicados e o conteúdo da página inicial. Dados pessoais e ações de escrita exigem as permissões correspondentes.

## Contas, identidade e administração

O cadastro em `/cadastro.html` envia nome de usuário, e-mail, senha e nascimento. O banco valida o nome de usuário, de 3 a 24 letras, números ou sublinhados, e impõe unicidade sem distinção entre maiúsculas e minúsculas. O nome de exibição é independente e editável. Nome de usuário, dono do perfil, código da conta e papel administrativo não podem ser alterados pela edição comum de perfil.

Perfis anteriores à atualização recebem o nome de usuário `jogador_` seguido do código da conta. Novos códigos de conta são gerados pelo banco com oito números e restrição de unicidade. Datas de nascimento são armazenadas em `account_details`, separadas do diretório público e da publicação Realtime.

A confirmação por e-mail permanece habilitada, conforme a decisão do usuário. Sem sessão retornada pelo Auth, o cadastro mostra a orientação para confirmar o endereço. Ele não cria um token fictício nem informa que a conta já está conectada. O SDK oficial gerencia persistência e renovação das sessões.

Administradores usam o painel `/admin.html` para localizar uma conta existente pelo e-mail e conceder acesso após conferir seu perfil. As funções `admin_find_account` e `admin_grant_access` exigem um administrador autenticado; a concessão confere também o código da conta. O primeiro administrador precisa ser definido pelo responsável pelo projeto em um contexto confiável do banco.

A migração `community_campaigns` remove a promoção automática baseada no antigo cadastro de e-mails reservados. `grimorio_private.admin_emails` permanece sem acesso pelos papéis do navegador, mas não promove novos cadastros. Um endereço informado no cadastro ou campos como `role` nos metadados não concedem administração. Administradores já existentes são preservados.

O painel permite editar os textos de apresentação e apoio da página inicial, gerenciar livros e consultar sugestões. O texto padrão descreve o Grimório como projeto amador, sem fins lucrativos, criado por amigos. O link da vaquinha aceita HTTPS e fica vazio enquanto a campanha de apoio estiver em preparação. Não há processamento de pagamentos no aplicativo.

## Amizades, campanhas e presença

`friend_requests` guarda pedidos pendentes. Somente o destinatário pode aceitar ou recusar; o remetente pode cancelar. A aceitação cria a amizade recíproca em `friendships`. Desfazer uma amizade remove os dois vínculos. Busca e respostas públicas expõem nome, avatar e código, sem divulgar e-mails.

Somente o mestre envia convites de campanha a amigos. O destinatário aceita ou recusa em **Campanhas**; aceitar cria a participação sem abrir obrigatoriamente o lobby. Os convites podem ser gerenciados a partir do cartão da campanha ou do lobby. Convites e entrada por código usam funções transacionais, e o limite de 10 participantes inclui o mestre.

Participação e presença são conceitos distintos: `campaign_members` conserva quem pertence à campanha, e os canais privados Realtime indicam quem está conectado. O lobby usa os identificadores autorizados dos participantes para atualizar os lugares ao redor da mesa.

## Fichas e dados em tempo real

Pastas pertencem ao usuário; o banco rejeita referências a pastas de outra conta e hierarquias cíclicas. A exclusão de uma pasta libera os vínculos das fichas e subpastas, preservando seus dados. Somente o dono organiza sua biblioteca, mesmo quando o mestre pode editar a ficha durante uma campanha.

O mestre acessa as fichas dos participantes e sua biblioteca pessoal. Um jogador acessa suas fichas e as atribuídas a ele, sem obter acesso às fichas dos outros jogadores ou à biblioteca inteira do mestre. O mesmo controle se aplica à leitura, às alterações e à sincronização em tempo real.

`save_character_sheet` verifica a versão esperada antes de salvar. Uma edição desatualizada é recusada, evitando que duas pessoas sobrescrevam silenciosamente as alterações uma da outra. `character_sheet_versions` publica uma sinalização pequena; os clientes autorizados buscam os dados atualizados da ficha. Retratos e todo o JSON não precisam circular como uma mensagem Realtime grande.

`campaign_rolls` conserva o histórico completo, com resultado, bônus, total, autor, horário e semente da animação. O servidor calcula o resultado e o total; o navegador não os escolhe. As últimas rolagens também permanecem no estado da campanha por compatibilidade. O histórico anterior que estava nesse estado é transferido pela migração, e a interface carrega páginas de registros mais antigos quando solicitado.

O modelo D20 do usuário em `public/assets/grimorio-d20.glb` é renderizado com Three.js e animado com física Cannon ES. Participantes recebem a mesma rolagem e semente para reproduzir a queda e o quique; a pose final apresenta o resultado definido pelo servidor. Movimento reduzido e ausência de WebGL preservam a leitura do resultado. As rolagens feitas nas fichas conectadas à campanha aparecem no tabuleiro e no histórico de todos os participantes.

Notas do mestre ficam em tabela separada e não entram no estado público da campanha. Mensagens privadas ficam restritas a remetente e destinatário, ambos membros da mesma campanha. Permissões de canais privados e RLS continuam sendo exigidas mesmo quando alguém chama as APIs diretamente.

## Funções e arquivos

Validações de nomes, tamanhos, vínculos, transições e permissões são feitas no banco. As implementações privilegiadas ficam em `grimorio_private`, com `search_path` fixo e verificações do usuário autenticado. Os pontos de entrada públicos usam `SECURITY INVOKER` e permissões de execução limitadas. Não coloque chaves administrativas no navegador.

O bucket `book-pdfs` oferece leitura pública de PDFs de até 20 MB, com escrita exclusiva de administradores. O painel permite trocar ou excluir arquivos e editar metadados/capas. Ao excluir um livro em destaque, a associação do anúncio é removida. Imagens do perfil, capas e anúncio mantêm validação de formato e tamanho.

## Conectar e publicar

`frontend.json` contém somente URL e chave pública publishable. Não contém senha, token administrativo ou `service_role`. `npm run build` empacota o SDK e conecta as páginas ao projeto configurado. Uma chave pública não libera dados privados: ainda é necessária uma sessão autorizada pelas políticas.

No Netlify, use a branch `main`, comando `npm run build` e pasta `dist`. As rotas são páginas HTML físicas; não use fallback SPA nem defina `GRIMORIO_BACKEND=sqlite` no deploy Supabase. Para testar o build localmente, execute `npm run preview` e abra http://localhost:3001. Essa prévia usa o banco Supabase configurado.

Em **Authentication → URL Configuration**, configure `https://scintillating-gumdrop-62c133.netlify.app/` como Site URL e Redirect URL. Adicione `http://localhost:3001/` para a prévia local. `config.toml` inclui essas URLs; a aplicação de `remotes.main` depende de a integração GitHub estar configurada para produção. Confira no [painel de URLs do projeto](https://supabase.com/dashboard/project/fisrzivzjfehmdnoxfkx/auth/url-configuration).

Para cadastros públicos, configure o provedor de e-mail em Auth. O SMTP padrão do Supabase tem restrições de envio; credenciais de um provedor próprio devem ficar no painel, nunca no Git. A configuração de URLs não substitui a configuração do serviço de e-mail.

## Migrações e dados existentes

Adicione alterações futuras como novas migrações. Não edite migrações já aplicadas nem execute reset no projeto remoto. Mantenha os nomes locais alinhados ao histórico remoto e confira as migrações existentes antes de aplicá-las novamente. A integração GitHub pode publicar novas migrações a partir de `main` quando estiver configurada para isso.

O banco `grimorio.sqlite` continua local e separado. Contas, senhas, sessões, documentos e PDFs não foram importados automaticamente. Uma importação posterior precisa mapear usuários aos IDs do Auth e transferir arquivos via Storage, sem publicar dados pessoais, hashes ou credenciais no repositório.

## Verificação

```powershell
npm.cmd test
npm.cmd run test:api
npm.cmd run test:content
npm.cmd run test:friends
npm.cmd run test:supabase:remote
npm.cmd run build
```

Os testes de banco executam SQL real em PostgreSQL/PGlite com representações dos schemas gerenciados do Supabase. Eles verificam isolamento entre contas, metadados de cadastro, unicidade, solicitações, convites, pastas, edições com versão, administração, rolagens, chat e PDFs. Testes do adaptador e Realtime usam respostas simuladas.

Para validar os fluxos no Chromium:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

O E2E usa servidor e SQLite temporários, com dois contextos de navegador para mestre/jogador, e cobre presença, convites, fichas simultâneas, D20, histórico e controle de acesso. Capturas ficam em `.tmp/screenshots/`. Ele não altera o banco Supabase nem testa o envio real de e-mail.

`test:supabase:remote` é somente leitura: confere conteúdo público e bloqueio de acesso sem autenticação. Não cria contas nem envia e-mails. A validação de cadastro e confirmação no ambiente hospedado depende do Auth e do provedor de e-mail reais; testes locais e de leitura não substituem essa etapa.
