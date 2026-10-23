# Análise do Grimório — 23/10/2026

## Escopo
Revisão do servidor Express, esquema e consultas SQLite, eventos Socket.IO e todas as páginas e scripts em public. Revisão estática dos fluxos de contas, campanhas, lobby, sessão, fichas, amigos, magias, livros e sugestões. Os testes abaixo cobrem os fluxos corrigidos; os demais fluxos não foram todos executados em navegador.

## Correções realizadas
- Removido o formulário de login criado automaticamente na página inicial. O shell agora oferece um botão no canto superior direito, um diálogo com fechamento por botão, Escape e clique fora, mensagens de erro e saída da conta. A página inicial normal não abre o diálogo; login=1 abre automaticamente quando uma página protegida solicita autenticação.
- Criação de campanhas passou a usar uma referência explícita ao campo campaignName. A leitura anterior de name.value usava window.name, enviava o nome vazio/ausente e disparava a validação do servidor. O novo fluxo remove espaços nas extremidades, rejeita nomes só com espaços e bloqueia envios duplicados enquanto aguarda resposta.
- Isolado o empilhamento de app-main, mantendo a navegação acima do conteúdo. Corrigida a herança de position:absolute e font-size:180px do seletor global .sigil sobre a marca da barra lateral. Adicionado suporte a expansão por foco do teclado e ajustes em telas estreitas.
- Definidos aliases das variáveis de cor e borda usadas por platform.css e ausentes no tema base.

## Pendências encontradas

### Alta prioridade: autorização no servidor
1. Socket.IO aceita room:join apenas com código e nome, sem validar sessão nem participação na campanha. Quem conhece o código pode entrar, obter o estado, mover tokens e rolar dados. A validação precisa acontecer no servidor, em cada conexão/evento relevante.
2. publicCampaign devolve state.notes e esse estado é transmitido aos participantes. Assim, notas apresentadas como privadas do mestre ficam acessíveis aos jogadores. É necessário separar estado público e notas privadas.
3. As rotas /api/campaigns/:code/sheets/:sheetId verificam se o usuário é mestre da campanha, mas não verificam se a ficha pertence a um membro daquela campanha. A atribuição também não valida o vínculo da ficha nem do destinatário. Restringir a consulta/alteração ao conjunto de fichas e membros da campanha.
4. session:chat aceita recipientSocketId sem verificar se o destinatário está na mesma campanha. Validar sala e vínculo antes da entrega de mensagens diretas.
5. GET /api/campaigns/:code e /members permitem a qualquer conta consultar dados da campanha pelo código. Definir quais informações são necessárias para aceitar um convite e reservar o estado completo e os membros aos participantes.

### Funcionalidade e consistência
- A ficha lança um dado local antes de pedir uma nova rolagem ao servidor em manualRoll. O valor mostrado pode diferir do compartilhado com a mesa. Usar o resultado confirmado pelo servidor quando houver campanha conectada.
- Trocar de campanha pelo Socket.IO não remove o socket da sala anterior. Isso pode misturar atualizações de mesas diferentes. Sair da sala anterior antes de entrar na nova.
- Outros formulários e scripts ainda dependem dos IDs expostos como propriedades globais do navegador. Migrar para seletores explícitos para evitar outros conflitos como o de window.name.
- Vários carregamentos e ações assíncronas, como as atualizações periódicas do lobby, não tratam falhas. Adicionar mensagens e recuperação para sessão expirada ou perda de conexão.
- public/app.js pertence a uma interface antiga e não é carregado pelas páginas atuais. Contém outro fluxo de autenticação e mesa, aumentando o risco de manutenção no arquivo errado.

### Próxima etapa de robustez
- Adicionar limites de tentativas em login/cadastro e limites de eventos por conexão.
- Criar migrações versionadas, rotina de backup e testes de autorização com duas contas de campanhas diferentes.
- Rever o uso de HTML gerado e dados de imagens conforme a aplicação receber conteúdo de terceiros.

## Verificações executadas
- npm test: 19 testes aprovados, cobrindo campanhas, perfil, catálogo, leitor, validações, cancelamento, recuperação de erros e sintaxe dos scripts.
- npm run test:api: cadastro, login, criação de campanha, nome vazio, listagem, consulta com papel de mestre e logout aprovados com servidor e SQLite temporários. O banco real não foi usado nesses testes.
- node --check server.js: aprovado.
- O layout e o comportamento do diálogo ainda precisam de inspeção visual em navegador em desktop e celular. Não foi realizado teste visual automatizado nesta revisão.

## Atualização — catálogo, perfil e anúncio
- Catálogo ganhou formulário de PDF e capa para administradores, leitor integrado, links diretos e download. Servidor valida título, tamanho, base64 e assinaturas de PDF/imagens. A validação identifica o formato e limites; não é uma análise completa de integridade ou antivírus.
- Perfil ganhou nome/foto clicáveis, editor com prévia e persistência. Shell isolado em escopo privado e integrado à ficha sem conflito entre funções globais.
- Anúncio usa arte preparada a partir do anexo e efeitos CSS, aceita troca por administrador e vínculo a um livro. Configuração persistida em site_settings.
- README foi atualizado com execução, permissões, limites e comandos de teste.
- Testes de conteúdo verificam permissões, arquivos inválidos, bytes e cabeçalhos PDF, perfil, anúncio e persistência após reiniciar um servidor temporário.
- A conta indicada pelo usuário foi promovida a administrador no banco local; a alteração foi salva e verificada.
- Nenhum navegador ou aplicativo foi exposto pela ferramenta de inspeção visual nesta sessão. A renderização ainda precisa de conferência visual em desktop e celular.



## Atualização — PDF, amigos, campanhas e ficha
- Diagnóstico em execução: o processo antigo na porta 3000 devolvia 404 em /api/content/permissions, deixando oculto o envio de PDFs. O servidor foi reiniciado com o código atualizado; a mesma rota passou a responder 200. Erros de consulta de permissões agora aparecem na tela, e selecionar PDF mostra nome/tamanho e sugere título.
- Contas receberam account_code único de 8 dígitos, com migração de contas existentes e índice único. O código não muda ao editar perfil. A conta administradora existente manteve sua função.
- Amigos ganhou busca por nome (sem diferenciar acentos/maiúsculas) ou código, identificação por código, cópia do próprio código, listagem e filtro. Resultados públicos de busca/amigos não expõem e-mail.
- Campanhas ganhou composição em cartões, resumo, busca, filtros de mestre/jogador, estado lobby/sessão, confirmação de convite copiado e mensagens de erro no formulário.
- Login de áreas protegidas passou a abrir automaticamente e preservar o destino interno. URLs externas são descartadas na volta do login.
- Ficha teve removido o efeito dos mínimos fixos que sobrescreviam os breakpoints; passou a 3/2/1 colunas, com componentes menores, margem para os marcadores e biblioteca adaptável. História virou painel de no máximo 480 px, sem reservar 790 px na ficha.
- Verificações: 22 testes de interface simulada/sintaxe aprovados; suites de API de campanhas, conteúdo/perfil/PDF e amigos aprovadas em bancos temporários. Migração e estabilidade do código após reinício foram verificadas. A API ativa foi consultada após a reinicialização.
- A ferramenta de navegador continua sem superfícies disponíveis; falta conferência visual em um navegador real, especialmente da ficha em diferentes resoluções.
