# Fase 2 — Mundo da campanha

Implementada em 30/10/2026, após a conclusão da Fase 1. Acesse **Campanhas → Abrir campanha** e use as abas **NPCs**, **Relações** e **Mapa**. Os dois backends, SQLite local e Supabase publicado, oferecem o mesmo comportamento.

## NPCs e relações

O Mestre cria, edita, busca e exclui NPCs com nome, descrição, visibilidade, ficha vinculada opcional e segredo privado. Novos NPCs ficam visíveis apenas ao Mestre. Marcar **Compartilhar com os jogadores** revela o nome e a descrição; o segredo continua privado. A ficha vinculada mantém suas permissões anteriores: vincular não concede acesso a uma biblioteca ou ficha.

Na aba **Relações**, o Mestre liga um NPC a outro NPC ou a uma ficha da companhia, com tipo de vínculo, descrição e visibilidade. Jogadores só recebem vínculos compartilhados quando também podem consultar os participantes da relação. Isso impede que o nome de um NPC oculto ou de uma ficha não autorizada apareça por meio de uma relação pública.

Excluir um NPC requer confirmação e remove suas relações e locais associados. A ficha vinculada é preservada. Excluir uma ficha remove relações direcionadas a ela e libera o vínculo de NPCs, mantendo o NPC.

## Mapa e locais

Cada campanha possui um mapa com título e imagem opcional PNG/JPG/WebP de até 3 MiB. A imagem é compartilhada com todos os membros; segredos devem ficar no campo privado de cada local. A imagem pode ser substituída ou removida sem apagar os locais.

O mapa oferece zoom de 100% a 300%, rolagem, seleção por marcador ou lista e detalhes do local. O Mestre pode marcar/reposicionar um local clicando no mapa ou preenchendo as coordenadas de 0 a 100% no formulário. As posições são proporcionais à imagem e funcionam em telas diferentes.

Locais têm nome, descrição, NPC opcional, visibilidade e segredo do Mestre. Novos locais são privados. Um local associado a um NPC oculto também fica oculto para jogadores, mesmo quando sua opção de compartilhamento está marcada. Não há neblina de guerra ou ocultação de partes da imagem nesta fase.

## Permissões e concorrência

Somente o proprietário da campanha gerencia o mundo. Ser administrador global não concede acesso especial. Anônimos e terceiros não consultam o mundo. Jogadores não podem alterar registros, mesmo chamando a API diretamente ou modificando os controles do navegador.

Segredos de NPCs e locais ficam em tabelas separadas. Respostas a jogadores omitem o campo `secret`, NPCs/locais ocultos e relações não autorizadas. As tabelas não são assinadas no Realtime; nenhuma imagem ou segredo é enviado como atualização pública.

Cada registro tem uma versão. Edições e exclusões enviam a versão consultada; uma versão antiga é recusada. O formulário conserva o rascunho e permite recarregar a versão salva após confirmação. Atualizações em tempo real não substituem formulários abertos.

## Banco e API

Migração: `supabase/migrations/20261030084850_campaign_world.sql`. Criada pela CLI, testada em PostgreSQL/PGlite e aplicada no projeto `fisrzivzjfehmdnoxfkx`; o nome local foi alinhado à versão remota. Não altera nem remove dados anteriores. No SQLite, as tabelas são criadas incrementalmente ao iniciar o servidor.

| Tabela | Conteúdo |
| --- | --- |
| `campaign_npcs` | NPCs e vínculo opcional com ficha |
| `campaign_npc_secrets` | Segredo privado de cada NPC |
| `campaign_relations` | Vínculos entre NPCs ou com fichas |
| `campaign_maps` | Imagem compartilhada, título e versão do mapa |
| `campaign_markers` | Locais e suas coordenadas |
| `campaign_marker_secrets` | Segredo privado de cada local |
| `campaign_world_versions` | Sinal pequeno de alteração, exclusivo do backend Supabase |

Todas as sete tabelas PostgreSQL têm RLS. As seis tabelas de dados têm políticas defensivas exclusivas do proprietário e não concedem leitura ou escrita direta aos papéis do navegador. O acesso ocorre pelas RPCs autorizadas, que projetam somente os campos permitidos. `campaign_world_versions` permite leitura aos membros/proprietário e não permite escrita direta.

`GET /api/campaigns/:code/world` consulta o mundo autorizado. `POST` na mesma rota cria, edita ou exclui uma entidade, com `kind`, `action`, `id`, `data` e `expectedVersion`. No Supabase, o adaptador usa `get_campaign_world` e `mutate_campaign_world`. Wrappers públicos são `SECURITY INVOKER`; as implementações privadas verificam autenticação, proprietário, vínculos e tipos, com `search_path` fixo. Não há escolha de proprietário ou papel pelo payload.

Mutações bloqueiam a campanha durante a transação PostgreSQL e usam transações no SQLite. FKs e validações impedem referências a outra campanha. Limites por campanha: 200 NPCs, 500 relações e 300 locais. Nome de NPC/local: 100 caracteres; vínculo/título do mapa: 120; descrição: 4.000 para NPC e 2.000 para relação/local; segredo: 10.000. Os limites recusam a operação, sem truncar silenciosamente os registros.

A imagem do mapa usa o armazenamento validado no banco já empregado por imagens de perfil. Não foi criado bucket novo. Esta escolha mantém o escopo de um mapa por campanha e evita arquivos órfãos; mapas maiores ou múltiplos precisam de uma evolução específica do armazenamento.

## Atualizações e arquivos

O Hub mantém seu único canal autorizado. `campaign_world_versions` emite apenas o identificador da campanha e uma versão; o adaptador converte isso em `campaign:world-changed`. No SQLite, o mesmo evento contém apenas o código. Cada navegador consulta novamente os dados autorizados quando uma das novas abas está aberta. Alterações em fichas, atribuições, membros, retorno à página e atualização manual também invalidam os dados pertinentes.

Frontend: `public/campaign-world.js`, `public/campaign-world.css` e integração em `campaign-hub.js`/`campanha-hub.html`. Não foram adicionados frameworks, dependências ou variáveis de ambiente.

## Verificação

- `npm.cmd test`: 87 testes aprovados, incluindo contrato compartilhado executado nos dois bancos, versões concorrentes, limites, referências, cascatas e acesso direto às tabelas.
- `node tests/campaign-world-e2e.mjs`: duas contas reais em navegador com banco temporário; criação/revelação de NPC, ficha vinculada, relação, conflito com rascunho preservado, upload de mapa, zoom, reposicionamento, sincronização, exclusão dependente e tela móvel. Capturas em `.tmp/screenshots/campaign-world-*.png`, fora do Git.
- `npm.cmd run test:supabase:remote`: RPCs presentes e acesso anônimo bloqueado, inclusive tabelas de segredos. Não cria contas, envia e-mails ou modifica registros reais.
- Consulta remota após migração: sete tabelas com RLS, nenhum acesso direto de navegador aos dados, nenhuma escrita direta no sinal, apenas o sinal na publicação Realtime e nenhum wrapper público com `SECURITY DEFINER`.
- O fluxo `npm.cmd run sync` inclui o novo E2E junto aos testes existentes, build, commit e push.

Os advisors não apontaram novos problemas de segurança. Permanecem os avisos anteriores de [proteção de senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) e da [tabela privada antiga sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Índices recém-criados aparecem como [ainda não utilizados](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) até o uso dos novos recursos; as FKs desta fase possuem índices.

Os testes de navegador usam SQLite isolado; os testes SQL exercitam as migrações reais em PGlite. O teste remoto verifica a implantação e bloqueios anônimos, sem simular login real de Mestre/jogador no Auth publicado.

## Próxima fase

Fase 3: recursos/transações de conjuração e inventários compartilhados. Combate, crônicas, dados secretos, widgets avançados do Mestre e Labs permanecem nas fases posteriores. Esta entrega não implementa essas áreas.
