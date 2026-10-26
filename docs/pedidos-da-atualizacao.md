# Pedidos da atualização do Grimório

Conferência em 26/10/2026. Os pedidos de rolagens compartilhadas e de física do D20 estão separados abaixo para acompanhar os 14 pontos. Este registro também preserva as decisões posteriores do usuário.

| Nº | Pedido | Implementação e onde usar |
| --- | --- | --- |
| 1 | Melhorar Amigos, solicitar amizade, aceitar e desfazer | **Amigos** permite procurar por nome/código, enviar pedido, aceitar, recusar, cancelar e desfazer amizade. A amizade só é criada após aceitação. |
| 2 | Mestre convidar jogadores no lobby | **Convidar amigos** no lobby abre os amigos disponíveis e envia convites. |
| 3 | Convidar e consultar participantes sem entrar no lobby | **Participantes e convites**, no cartão de campanha, mostra a composição da campanha e permite convidar amigos. Os convidados respondem em **Convites recebidos**. |
| 4 | Cadastro em tela própria com usuário, e-mail, senha e nascimento | `/cadastro.html` contém os quatro campos. **Decisão posterior:** manter a confirmação por e-mail. O cadastro explica essa etapa e só redireciona autenticado quando o Auth devolve uma sessão válida. |
| 5 | Perfil melhorado, usuário único, exibição independente e copiar código | **Editar perfil** permite alterar nome de exibição e foto. Usuário é único e imutável; código de oito números aparece como texto com botão **Copiar código**. |
| 6 | Presença simultânea ao redor da mesa do lobby | Os lugares mostram os membros online/ausentes e se atualizam com a presença da sala. Ser membro não exige estar online. |
| 7 | Visões distintas e mestre editar fichas ao vivo | Na sessão, o mestre acessa fichas dos membros e sua biblioteca; jogadores acessam suas fichas e as atribuídas a eles. Alterações sincronizam com controle de versão e aviso de conflito. |
| 8 | “Fichas dos players” e “Minhas fichas” na lateral | A visão do mestre contém as duas seções, organiza sua biblioteca por pasta e permite atribuir fichas preparadas a jogadores. |
| 9 | Pastas e subpastas na biblioteca de fichas | **Fichas** permite criar, abrir, renomear e excluir pastas/subpastas e mover fichas entre elas. Excluir uma pasta preserva as fichas. |
| 10 | Fichas abaixo do tabuleiro, móveis e redimensionáveis | Clique na ficha na lateral da sessão. Arraste pelo título, redimensione pelo canto, recolha ou restaure a janela. |
| 11 | Rolagens da ficha compartilhadas, resultado/bônus/total e histórico | Atributos, perícias, dano e rolagens manuais conectadas à campanha aparecem para os participantes da mesa. O histórico persiste no banco e permite carregar registros anteriores. |
| 12 | Modelo personalizado do D20 com queda, giro e quique | `public/assets/grimorio-d20.glb` contém o modelo encontrado na pasta autorizada do usuário. Three.js o renderiza e Cannon simula a física com uma semente compartilhada. **O servidor sorteia o resultado; a pose final apresenta esse resultado.** |
| 13 | Painel restrito a administradores | **Administração** permite localizar conta existente por e-mail e conceder acesso, editar/excluir livros e trocar PDFs/capas, editar textos da página inicial e consultar sugestões. APIs e banco também verificam o papel administrativo. |
| 14 | Repaginar o início e apresentar o projeto/apoio | A página inicial apresenta o projeto amador, sem fins lucrativos, criado por amigos. A vaquinha aparece em preparação até o administrador cadastrar um link HTTPS. |

## Verificação

- Testes de unidade, APIs locais e políticas PostgreSQL/PGlite: cadastro, autorização, solicitações, convites, pastas, edição concorrente, PDFs e histórico.
- Testes com dois navegadores: mestre/jogador, presença, edição nos dois sentidos, mesma rolagem, organização das fichas e layout móvel.
- Validação no Supabase com contas temporárias: Auth, solicitações, convites, Realtime, permissões, PDFs e administração. As contas e os arquivos temporários foram removidos.
- A confirmação de cadastro por e-mail foi mantida; o envio real depende da configuração do provedor de e-mail do Supabase.

Os testes de regressão também cobrem a atualização dos cartões com convites pendentes e a recuperação da sala após reconexão do servidor local.
