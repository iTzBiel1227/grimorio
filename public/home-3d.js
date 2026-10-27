(() => {
  const canvas=document.getElementById('homeDiceCanvas');if(!canvas)return;
  let scene=null,observer=null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function start(){if(!scene&&window.GrimorioDice?.createHome)scene=window.GrimorioDice.createHome(canvas);}
  function reveal(){
    observer?.disconnect();observer=null;
    const sections=document.querySelectorAll('[data-scroll-reveal]');
    if(reduced.matches){sections.forEach(section=>section.classList.add('is-revealed'));return;}
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-revealed');observer.unobserve(entry.target);}},{threshold:.08});
    for(const section of sections){if(section.getBoundingClientRect().top<innerHeight*.95)section.classList.add('is-revealed');else observer.observe(section);}
    document.documentElement.classList.add('home-motion-ready');
  }
  start();reveal();reduced.addEventListener('change',reveal);
  window.addEventListener('pagehide',()=>{scene?.destroy();scene=null;observer?.disconnect();});
  window.addEventListener('pageshow',event=>{if(event.persisted){start();reveal();}});
})();
