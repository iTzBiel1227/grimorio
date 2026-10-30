# Grimório — expansão de campanhas

Entregues: **Fase 1 — Hub, permissões e Modo Mestre** e **Fase 2 — NPCs, relações e mapa interativo**, autorizada na continuação do projeto. As fases 3 a 7 permanecem planejadas. Este documento conserva os detalhes da Fase 1; a [documentação da Fase 2](docs/mundo-da-campanha.md) registra os novos recursos, banco e validações.

## Análise do projeto e plano técnico

A análise abrangeu `package.json`, páginas/scripts de `public/`, servidor, clientes 3D, migrations, testes e documentação. O projeto usa HTML e JavaScript em páginas físicas, sem React, TypeScript ou roteador SPA. Há dois backends que precisam continuar compatíveis:

- Publicação estática: Supabase Auth, PostgreSQL, Storage e Realtime, por meio de `public/supabase-client.js` e `public/supabase-realtime.js`.
- Execução local: Express, SQLite e Socket.IO em `server.js`.

Campanhas, membros, convites, amizades, bibliotecas de fichas, pastas, atribuições, edição concorrente, notas privadas, chat e histórico de dados já existem. As magias já têm biblioteca pública/privada e importação para a ficha. Livros usam o bucket `book-pdfs`. Sugestões já possuem autor, texto e data. O papel global é `user`/`admin`; o Mestre é o proprietário da campanha, independentemente da administração global. Não foi criado outro sistema de papéis.

Os modelos `grimorio-d20.glb` e `grimorio-dice-set.glb` já atendem D4/D6/D8/D10/D12/D20/D100, com Three.js/Cannon ES e resultado do servidor. Foram preservados. A tabela SQLite `sessions` guarda autenticação, não encontros de RPG. O status anterior `lobby`/`session` não guardava datas ou histórico de encontros.

Plano aplicado: adicionar uma página de Hub, estender as campanhas existentes com metadados, reutilizar as notas privadas e componentes visuais, criar somente a fundação mínima de sessões necessária à visão geral e testar autorização nos dois backends. Preservar lobby, mesa, autenticação e funcionalidades existentes.

## Implementado

- Hub com capa, nome, descrição, sistema, Mestre, jogadores, contagem, estado, resumo público e próxima sessão.
- Abas Visão geral, Personagens e Sessões; acesso à mesa e ao diálogo existente de participantes/convites.
- Criação, entrada e abertura da campanha levam ao Hub. Links antigos de convite/lobby continuam funcionando.
- Gerenciamento de nome, descrição, resumo, agendamento e capa exclusivo do Mestre.
- Modo Mestre com identificação visual consistente e leitura/edição das notas privadas existentes. Um jogador ou administrador global não recebe acesso por ativar controles do navegador ou falsificar o payload.
- Iniciar, continuar e encerrar sessão, com número, título, início e término; confirmação antes de encerrar. Histórico limitado aos últimos 20 encontros.
- Sessão ativa única por campanha e início idempotente, inclusive chamadas simultâneas.
- Fichas disponíveis conforme permissões existentes: o Mestre consulta as bibliotecas dos membros, e o jogador consulta suas fichas e as atribuídas. Esta fase não cria vínculo exclusivo ficha–campanha.
- Estados de carregamento, indisponibilidade, falha de conexão, erro de upload e ausência de dados; layout responsivo preto/grafite/vermelho.
- API local de prévia de convite corrigida: um convidado ainda não associado não recebe tokens, rolagens ou notas.

## Banco de dados

PostgreSQL: novos campos `description`, `recent_summary`, `next_session_at` e `cover_path` em `campaigns`; nova tabela `campaign_sessions`, com FK para campanha, exclusão em cascata, número único por campanha, título limitado e somente uma sessão aberta.

SQLite: os campos equivalentes são criados incrementalmente ao iniciar o servidor, com `cover_data` para a imagem local. `campaign_sessions` é separada de `sessions` de autenticação. As transições usam transações e os índices impedem sessões abertas duplicadas.

Não foram duplicados usuários, membros, notas, fichas ou rolagens. Nenhuma conta, campanha ou ficha é removida pela atualização.

**Campanhas legadas em sessão:** como a data de início anterior não existia, a migração preserva a mesa aberta e registra uma sessão com início no momento da migração. Não reconstrói nem inventa encontros anteriores. No SQLite, a mesma adaptação ocorre no primeiro início do servidor atualizado.

## Migrations

`supabase/migrations/20261029122743_campaign_hub.sql`, inicialmente gerada com a CLI Supabase e validada executando SQL real em PostgreSQL/PGlite. O nome foi alinhado à versão registrada ao aplicar a migração no projeto remoto.

RPCs: `get_campaign_hub`, `update_campaign_hub`, `start_campaign_session` e `end_campaign_session`. Wrappers públicos usam `SECURITY INVOKER`; operações privilegiadas permanecem no schema privado, com autenticação, verificação de proprietário/membro, `search_path` fixo e permissões explícitas.

O caminho legado de alteração do status pelo Mestre é mantido por um trigger que sincroniza a sessão na mesma transação, para compatibilidade com páginas já abertas. Clientes atualizados usam as RPCs.

Aplicada no projeto `fisrzivzjfehmdnoxfkx` em 29/10/2026, versão `20261029122743`. A consulta posterior confirmou RLS, leitura autenticada sem escrita direta em `campaign_sessions`, bloqueio de anônimos, bucket privado de 3 MiB, nenhum wrapper público privilegiado e nenhuma divergência entre status da campanha e sessão ativa.

## Novos componentes

- `public/campanha-hub.html`: página do Hub e diálogos de gerenciamento/confirmação.
- `public/campaign-hub.js`: ações, permissões, navegação e atualização da página.
- `public/campaign-hub.css`: estilos responsivos usando a identidade existente.
- `tests/campaign-hub-api.test.js`: integração Express/SQLite/Socket.IO com banco temporário.
- `tests/campaign-hub-database.test.js`: migrações, RPCs, RLS e compatibilidade PostgreSQL.

Reutilizados: `Grimorio.api`, autenticação/avatares/escape em `shell.js`, `GrimorioCampaignPeople`, bibliotecas de fichas, notas e adaptador de Realtime. Nenhum framework novo.

## Rotas

Página: `/campanha-hub.html?code=CODIGO`. Login/cadastro preservam esse destino. `/campanha.html`, `/lobby.html`, `/sessao.html` e `/ficha.html?campaign=CODIGO&sheet=ID` continuam disponíveis.

| API comum aos dois backends | Acesso |
| --- | --- |
| `GET /api/campaigns/:code/hub` | Membro ou Mestre |
| `PUT /api/campaigns/:code/hub` | Mestre |
| `PUT /api/campaigns/:code/cover` | Mestre |
| `GET/PUT /api/campaigns/:code/notes` | Mestre |
| `POST /api/campaigns/:code/start` | Mestre; reutiliza sessão ativa |
| `POST /api/campaigns/:code/lobby` | Mestre; encerra sessão ativa |

No build Supabase, as URLs acima são o contrato do adaptador do navegador; não exigem hospedar o Express no Netlify.

## Realtime

O Hub usa um único socket/canal autorizado por campanha, com limpeza no `pagehide`. Atualizações de metadados, status e membros recarregam apenas os dados autorizados, com agrupamento de eventos próximos. Fichas são carregadas quando a aba é aberta e invalidadas pelos sinais existentes.

O Supabase reutiliza a publicação de `campaigns`; o modo `view: 'hub'` usa a RPC do Hub e evita carregar tabuleiro, chat, histórico de rolagens e notas privadas automaticamente. Não cria subscriptions de chat/rolagens para o Hub. No modo local, uma sala separada recebe `campaign:updated` contendo somente o código e sinais para recarregar as fichas autorizadas; movimentos, chat e rolagens da mesa não recarregam o Hub. Não há novo polling periódico no Hub.

Falhas de conexão são informadas e a atualização manual continua disponível. Voltar a uma página mantida no cache do navegador reconecta o Hub e conserva o rascunho privado. Notas/formulários em edição não são sobrescritos por atualização pública. As notas só ficam editáveis após o carregamento inicial e também podem ser recarregadas explicitamente pelo Mestre.

## RLS

- Campanhas continuam legíveis apenas pelos membros/proprietário; a prévia de convite é limitada.
- `campaign_sessions` permite leitura aos membros e Mestre. Escrita direta da tabela não é concedida ao cliente; as transações autorizadas fazem as alterações.
- `campaign_notes` continua sendo a fonte privada de notas, com policy exclusiva do proprietário. Não foi incluída na publicação Realtime.
- Admin global não obtém permissão de Mestre em campanhas alheias.
- As novas RPCs exigem autenticação e verificam o vínculo real no banco; payloads não escolhem proprietário, papel ou permissões.
- Nenhuma chave secreta ou `service_role` foi acrescentada ao cliente.

Referências usadas na revisão: [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [controle de acesso ao Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Storage

O bucket existente `book-pdfs` permanece inalterado. A capa usa o novo bucket **privado** `campaign-covers`, com limite de 3 MiB e tipos PNG/JPEG/WebP. O caminho é `ID_DA_CAMPANHA/ID_ALEATORIO.ext`.

Membros podem ler a capa; somente o Mestre pode enviar/remover arquivos da campanha. Não há permissão de sobrescrita: uma substituição cria um novo caminho. O RPC só aceita caminhos válidos da própria campanha com objeto existente. O adaptador valida tamanho e assinatura básica do arquivo antes do upload e usa URL assinada com validade de uma hora. O bucket valida tamanho/MIME no serviço; as policies autorizam por campanha. Não há processamento de arquivos SVG ou URLs públicas de capa.

Falha ao salvar metadados tenta remover o novo upload. Uma falha ao limpar o arquivo antigo é informada sem desfazer a capa já salva. Uploads interrompidos/concorrentes podem deixar arquivos sem referência; limpeza periódica automática fica pendente. URLs já assinadas têm validade até expirar, mesmo após sair de uma campanha.

No modo SQLite, a capa segue a validação de imagens já existente e permanece no banco local, ignorado pelo Git.

## Dependências adicionadas

Nenhuma. Reutilizados Supabase JS, Express, better-sqlite3, Socket.IO, Playwright e PGlite presentes no projeto.

## Variáveis de ambiente

Nenhuma nova variável. Arquivos `.env`, credenciais e `.gitignore` preservados. O build continua usando `supabase/frontend.json` ou as variáveis públicas já documentadas no README.

## Validação e erros

Os testes novos cobrem Mestre, jogador, terceiro, administrador global e anônimo; tentativas de falsificação, notas privadas, datas/tamanho/tipo de capa, sessões concorrentes e idempotentes, reinício/backfill e policies de Storage. São usados bancos temporários, sem contas de teste persistentes no serviço publicado.

Validações de 29/10/2026: `npm.cmd test` passou com 83 testes; `node tests/community-e2e.mjs` passou com contas de Mestre/jogador e capturas desktop/móvel; `npm.cmd run test:supabase:remote` confirmou as novas RPCs e o bloqueio de acesso anônimo. Não há script `lint` no `package.json`; a suíte existente verifica sintaxe de JavaScript e o build real. O comando final de sincronização também exige os testes de API, conteúdo, amigos, navegador, dados 3D e build antes do commit/push.

Os advisors do Supabase não apontaram novos problemas de segurança após a migração. Permanecem os avisos anteriores de [proteção de senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e da [tabela privada de e-mails administrativos sem policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), intencionalmente inacessível ao navegador. Os avisos de desempenho anteriores permanecem; o índice recém-criado do histórico encerrado aparece como [ainda não utilizado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), esperado antes de uso real.

## Funcionalidades pendentes

- Fase 2 concluída: NPCs públicos/privados, relações e mapa interativo estão nas abas do Hub. Consulte [Mundo da campanha](docs/mundo-da-campanha.md).
- Fase 3: recursos/transações de conjuração e inventários compartilhados. A biblioteca/importação de magias existente permanece.
- Fase 4: participantes/eventos associados à sessão, combate, iniciativa, HP/condições e fundação de crônicas. A sessão mínima desta entrega não implementa essas funcionalidades.
- Fase 5: evolução das rolagens contextuais/secretas. Dados 3D e histórico já existentes foram preservados.
- Fase 6: Tela do Mestre com widgets, layout e integrações. O Modo Mestre desta fase cobre notas e administração existentes; HP secreto, armadilhas e locais ocultos dependem das entidades futuras.
- Fase 7: evolução das sugestões para Labs, categorias, votos, comentários, moderação e autoria da comunidade.
- Workshop, loja/pagamentos e Discord não foram implementados.
- Paginação de sessões além das últimas 20, atualização concorrente de notas com versionamento e limpeza automática de capas sem referência são melhorias futuras.

## Próxima fase

Fase 3: recursos/transações de conjuração e inventários compartilhados. Antes de implementar, revisar novamente as fichas, magias e atribuições existentes para preservar seus dados e permissões.

Para executar localmente, reinicie o servidor atualizado com `npm.cmd start`. Para gerar a publicação, use `npm.cmd run build`. As migrations versionadas são a fonte das mudanças no Supabase; não são necessárias edições manuais de tabelas pelo Dashboard.
