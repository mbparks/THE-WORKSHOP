'use strict';

const dialog=document.querySelector('#shot-dialog');
const dialogImage=document.querySelector('#dialog-image');
const dialogCaption=document.querySelector('#shot-caption');
let lastTrigger=null;

for(const button of document.querySelectorAll('.shot-button')){
  button.addEventListener('click',()=>{
    lastTrigger=button;
    const image=button.querySelector('img');
    dialogImage.src=button.dataset.shot||image?.src||'';
    dialogImage.alt=image?.alt||'THE WORKSHOP feature screenshot';
    dialogCaption.textContent=button.dataset.caption||'';
    dialog.showModal();
  });
}

document.querySelector('[data-close-dialog]')?.addEventListener('click',()=>dialog.close());
dialog?.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
dialog?.addEventListener('close',()=>{dialogImage.removeAttribute('src');lastTrigger?.focus();});

const sectionLinks=[...document.querySelectorAll('.tour-index a')];
const sections=sectionLinks.map(link=>document.querySelector(link.getAttribute('href'))).filter(Boolean);
const observer=new IntersectionObserver(entries=>{
  const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
  if(!visible)return;
  for(const link of sectionLinks)link.classList.toggle('active',link.getAttribute('href')===`#${visible.target.id}`);
},{rootMargin:'-25% 0px -58% 0px',threshold:[0,.1,.3,.6]});
for(const section of sections)observer.observe(section);
