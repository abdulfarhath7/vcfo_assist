#!/bin/bash
# Part B wizard: jump section by section via stepper li.listep#blockN, open Add/Edit sub-panels, capture each.
cd ~/mca-capture
run() { rm -f cmd.out; local n=$(grep -c '^\[.*\] cmd ' recorder.out); echo "$1" > cmd.txt; local t=0; while [ "$(grep -c '^\[.*\] cmd ' recorder.out)" -le "$n" ] && [ $t -lt 240 ]; do sleep 0.5; t=$((t+1)); done; tail -1 cmd.out 2>/dev/null; }
VIS='const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled;};'
STATE='(()=>{'"$VIS"' const act=[...document.querySelectorAll("li.listep")].filter(l=>/active|current|selected/i.test(l.className)).map(l=>l.id+":"+l.textContent.trim().slice(0,30)); const inputs=[...document.querySelectorAll("input,select,textarea")].filter(vis).length; return act.join(",")+" | inputs="+inputs;})()'
ADDEDIT='(()=>{'"$VIS"' return [...document.querySelectorAll("button")].filter(e=>/add\s*\/?\s*edit|add (subscriber|director|details|nominee)|^add$/i.test((e.textContent||"").trim())&&vis(e)).map(e=>e.id||"").filter(Boolean);})()'
url=$1
run "goto $url"; run "wait 5000"
run "eval (()=>{const b=document.querySelector('#okInfoModalBtn'); if(b&&b.offsetParent){b.click();return 'MODAL_OK'} return 'NO_MODAL'})()"; run "wait 2000"
steps=$(run "eval (()=>[...document.querySelectorAll('li.listep')].map(l=>l.id).join(' '))()" | tr -d '"')
echo "stepper ids: $steps"
for id in $steps; do
  r=$(run "eval (()=>{const l=document.getElementById('$id'); if(!l) return 'NOID'; l.scrollIntoView({block:'center'}); const s=l.querySelector('.icon-circle')||l; s.click(); l.click(); return 'CLICKED '+l.textContent.trim().slice(0,40);})()")
  run "wait 4000"; st=$(run "eval $STATE"); echo "== $id -> $r :: $st"; run "capture"
  ids=$(run "eval $ADDEDIT" | python3 -c "import sys,json; print(' '.join(json.loads(sys.stdin.read() or '[]')))" 2>/dev/null)
  for b in $ids; do
    r=$(run "eval (()=>{const e=document.getElementById('$b'); if(!e) return 'NOID'; e.scrollIntoView({block:'center'}); e.click(); return 'OPENED '+e.textContent.trim().slice(0,30);})()"); run "wait 3500"
    st=$(run "eval $STATE"); echo "   $b -> $r :: $st"; run "capture"
    run "eval (()=>{const l=document.getElementById('$id'); const s=l&&(l.querySelector('.icon-circle')||l); if(s){s.click(); l.click();} return 'RESET';})()"; run "wait 2500"
  done
done
echo DONE $(date +%T)
