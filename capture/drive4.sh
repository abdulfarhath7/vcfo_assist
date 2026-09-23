#!/bin/bash
# Part B: pass 1 walk all sections with Next; pass 2 for each section's Add/Edit buttons, reload + Next×k + open + capture.
cd ~/mca-capture
run() { rm -f cmd.out; local n=$(grep -c '^\[.*\] cmd ' recorder.out); echo "$1" > cmd.txt; local t=0; while [ "$(grep -c '^\[.*\] cmd ' recorder.out)" -le "$n" ] && [ $t -lt 240 ]; do sleep 0.5; t=$((t+1)); done; tail -1 cmd.out 2>/dev/null; }
VIS='const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled;};'
NEXT='(()=>{'"$VIS"' const b=[...document.querySelectorAll("button, span.iconButton-label, a")].filter(e=>/^\s*Next\s*$/i.test((e.textContent||"").trim())&&vis(e)); if(!b.length) return "NONE"; const t=b[b.length-1]; t.scrollIntoView({block:"center"}); t.click(); return "CLICKED "+b.length;})()'
STATE='(()=>{'"$VIS"' const inputs=[...document.querySelectorAll("input,select,textarea")].filter(vis); const labs=inputs.slice(4,9).map(i=>{const p=i.closest("[class*=guideField], .form-group, label, td, li"); const l=p&&p.querySelector("label, .guideFieldLabel"); return ((l?l.textContent:i.placeholder)||"").trim().slice(0,22)}); return "inputs="+inputs.length+" | "+labs.join("; ");})()'
ADDEDIT='(()=>{'"$VIS"' return [...document.querySelectorAll("button")].filter(e=>/add\s*\/?\s*edit|add (subscriber|director|details|nominee)|^add$/i.test((e.textContent||"").trim())&&vis(e)).map(e=>e.id||"").filter(Boolean);})()'
url=$1
load() { run "goto $url" >/dev/null; run "wait 5000" >/dev/null; run "eval (()=>{const b=document.querySelector('#okInfoModalBtn'); if(b&&b.offsetParent){b.click();return 'MODAL_OK'} return 'NO_MODAL'})()" >/dev/null; run "wait 2500" >/dev/null; }
nexts() { for i in $(seq 1 $1); do run "eval $NEXT" >/dev/null; run "wait 4500" >/dev/null; done; }
echo "PASS1 $(date +%T)"; load
declare -A AE
for k in $(seq 0 11); do
  st=$(run "eval $STATE"); ids=$(run "eval $ADDEDIT" | python3 -c "import sys,json; print(' '.join(json.loads(sys.stdin.read() or '[]')))" 2>/dev/null)
  echo "section $k :: $st :: addedit=[$ids]"; AE[$k]="$ids"; run "capture" >/dev/null
  r=$(run "eval $NEXT"); [[ "$r" == *NONE* ]] && { echo "no Next at $k"; break; }
  run "wait 4500" >/dev/null
  st2=$(run "eval $STATE"); [[ "$st2" == "$st" ]] && { echo "Next did not advance at $k ($r)"; break; }
done
echo "PASS2 $(date +%T)"
for k in "${!AE[@]}"; do
  for b in ${AE[$k]}; do
    echo "reload -> section $k -> open $b"; load; nexts $k
    r=$(run "eval (()=>{const e=document.getElementById('$b'); if(!e) return 'NOID'; e.scrollIntoView({block:'center'}); e.click(); return 'OPENED '+e.textContent.trim().slice(0,30);})()"); run "wait 4000" >/dev/null
    echo "   $r :: $(run "eval $STATE")"; run "capture" >/dev/null
  done
done
echo DONE $(date +%T)
