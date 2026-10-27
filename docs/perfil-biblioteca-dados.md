# Perfil, biblioteca e dados 3D — outubro de 2026

Esta atualização atende os sete pedidos de apresentação, perfil, magias e dados. Os recursos anteriores de campanhas, fichas, amizades, livros e administração continuam disponíveis.

| Pedido | Como usar |
| --- | --- |
| Início com rolagem suave e D20 grande | O modelo original aparece semitransparente ao fundo e gira conforme a rolagem da página. “Desça para explorar” leva à apresentação. |
| Amigos em uma lista compacta | A página concentra os amigos aceitos. “Adicionar amigo” abre a busca; o sino abre as solicitações recebidas e enviadas. O menu de cada amigo permite copiar seu código e desfazer a amizade. |
| Perfil mais completo | Clique no perfil, no alto à direita. Edite nome de exibição, foto, banner e “Sobre mim” (até 280 caracteres), com prévia antes de salvar. Nome de usuário e código continuam fixos. Molduras ficam para uma futura atualização. |
| Criações públicas dos administradores | Em Administração → Magias e habilidades, crie, edite ou exclua publicações. Tudo criado ali aparece na biblioteca pública. |
| Imagens dos poderes | Magias e habilidades aceitam PNG, JPG ou WebP de até 3 MiB. A imagem pode ser substituída ou removida. |
| Biblioteca e criações pessoais | Magias abre na biblioteca pública, mesmo sem login. “Minhas magias” exige sessão e guarda somente as criações daquela conta. Busca e filtros encontram magias e habilidades por nome, descrição ou dano. |
| Todos os dados com o mesmo sistema 3D | D4, D6, D8, D10, D12, D20 e D100 usam os modelos fornecidos e a mesma simulação física sincronizada da mesa. D100 aparece como um dado de dezenas acompanhado de um D10 de unidades; 00 + 0 representa 100. |

Os seis modelos adicionais vieram sem números. O renderizador acrescenta números vermelhos às faces, mantendo as malhas do arquivo original. O servidor continua determinando o resultado e a semente compartilhada: a física apresenta a rolagem e a pose final mostra o resultado recebido, sem recalcular um resultado diferente por jogador.

Na ficha, a aba Habilidades permite buscar e importar poderes públicos ou pessoais. Uma miniatura WebP de até 24.000 caracteres acompanha a cópia; a imagem original de até 3 MiB não é duplicada em cada ficha. Alterar ou excluir a publicação não modifica cópias já salvas nas fichas.

## Dados e publicação

A migração `20261027013328_profile_and_public_grimoire.sql` foi aplicada ao projeto Supabase `fisrzivzjfehmdnoxfkx`. Ela acrescenta `profiles.banner_data`, `profiles.bio` e `grimoire_entries.image_data`, mantendo os registros existentes. Visitantes podem ler apenas poderes públicos; criações pessoais continuam privadas mesmo para outros administradores. A edição não pode transformar silenciosamente um registro privado em público.

No modo Express/SQLite, os mesmos campos são acrescentados automaticamente ao iniciar o servidor atualizado. O build para Netlify continua em `dist`, com `npm run build`. Não há alteração nas configurações de confirmação por e-mail.

## Validação

- Testes de API em SQLite temporário e políticas SQL em PostgreSQL/PGlite.
- Navegador com contas separadas: banner e biografia após recarregar, pedidos e remoção de amizade, publicação pública, criação privada, busca, importação ilustrada para a ficha e recursos anteriores da campanha.
- Inspeção visual em desktop e celular, animação com rolagem, preferência por movimento reduzido e renderização dos sete tipos de dado.
- Teste no Supabase hospedado com duas contas temporárias: login, perfil, leitura anônima, publicação administrativa e isolamento de criações pessoais. Contas e conteúdo de teste foram removidos ao concluir.

`npm run test:e2e` executa os testes da comunidade e os de visualização 3D. Capturas ficam em `.tmp/screenshots/`, fora do Git.
