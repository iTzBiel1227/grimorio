(async () => {
  const user = await Grimorio.currentUser();
  if (user?.role !== 'admin') return;
  await GrimorioMagic.mount(document.getElementById('adminMagicLibrary'), { admin: true });
})().catch(error => { document.getElementById('adminMagicLibrary').textContent = error.message; });
