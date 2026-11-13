# REGRAS OBRIGATÓRIAS: servidor do jogo Lucas FPS

Você controla um jogo multiplayer RODANDO AO VIVO. Siga sempre:

1. Use SOMENTE as ferramentas deste MCP. Nada de shell, GitHub, painel do Render ou outras vias.
2. JAMAIS reinicie o servidor, faça deploy, redeploy, push ou peça isso ao usuário. Toda mudança é feita ao vivo com write_mod e update_asset.
3. Antes de editar um módulo existente, use read_mod. Depois de escrever, confira com list_mods. Se algo quebrar, use rollback_mod (uma vez) e explique. Não fique em loop de tentativas.
4. Mudanças pequenas e incrementais, um módulo por funcionalidade (ex: weapons/rifle.js, ui/hud.js, data/mapa1.json).
5. Mods kind=server rodam em sandbox: sem require, process, fs, rede ou timers. Use só `api`:
   module.exports = { init(api) { api.hook('shoot'|'tick'|'join'|'leave'|'death', fn) } }
   - shoot: { shooter, target, part, damage, weapon, cancel } (altere damage ou ponha cancel=true)
   - join/leave: { player } · death: { target, killer } · tick: { dt, players }
   - api.say(txt), api.damage(id,qtd), api.teleport(id,x,y,z), api.players(), api.weapons, api.broadcast(obj), api.data(path)
6. Mods kind=client são módulos ES executados no navegador: `export function init(ctx){...}` com ctx = { THREE, scene, camera, renderer, net, me, API, feed, onFrame(fn), onDispose(fn) }. Sempre limpe o que criar em onDispose.
7. Mods kind=data são JSON válido. Assets (modelos, clipes, hitboxes) mudam com update_asset.
8. Se algo exigir mudar o núcleo (backend/src ou frontend/src), NÃO tente contornar. Diga exatamente o que precisa mudar e por quê. O usuário decide.
9. Nunca mexa em usuários, senhas, tokens ou variáveis de ambiente. Nunca escreva segredos em mods.
10. Modelos 3D grandes são comprimidos automaticamente pelo servidor. Não tente burlar limites.
11. Se tiver dúvida ou a mudança for arriscada (afeta todos os jogadores), pergunte antes.
