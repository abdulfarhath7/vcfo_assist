#!/bin/bash
cd ~/mca-capture
run() { rm -f cmd.out; local n=$(grep -c '^\[.*\] cmd ' recorder.out); echo "$1" > cmd.txt; local t=0; while [ "$(grep -c '^\[.*\] cmd ' recorder.out)" -le "$n" ] && [ $t -lt 120 ]; do sleep 0.5; t=$((t+1)); done; tail -1 cmd.out 2>/dev/null; }
VIS='const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled;};'
CLICK_TEXT='(()=>{'"$VIS"' const b=[...document.querySelectorAll("button, span, a, div[role=button]")].filter(e=>new RegExp("^\\s*"+TXT+"\\s*$","i").test((e.innerText||"").trim())&&vis(e)); if(!b.length) return "NONE"; const t=b[b.length-1]; t.scrollIntoView({block:"center"}); t.click(); return "CLICKED "+b.length+" "+(t.id||t.className);})()'
ADDEDIT='(()=>{'"$VIS"' const b=[...document.querySelectorAll("button")].filter(e=>/add\s*\/?\s*edit|add (subscriber|director|details)/i.test((e.innerText||"").trim())&&vis(e)&&!e.closest(".modal")); return b.map(e=>e.id||"").filter(Boolean);})()'
CLOSE_MODAL='(()=>{'"$VIS"' const m=[...document.querySelectorAll(".modal")].filter(vis).pop(); if(!m) return "NO_MODAL"; const b=[...m.querySelectorAll("button, span, a")].filter(e=>vis(e)&&/^\s*(close|cancel|×|x|ok|back)\s*$/i.test((e.innerText||e.getAttribute("aria-label")||"").trim())); const c=m.querySelector("[data-dismiss=modal], .close, [aria-label=Close]"); const t=c&&vis(c)?c:b[0]; if(!t) return "NO_CLOSE_BTN"; t.click(); return "CLOSED "+(t.id||t.className);})()'
for spec in "$@"; do
  name=${spec%%|*}; url=${spec#*|}; echo "=== $name $(date +%T)"
  run "goto $url"; run "wait 6000"
  run "eval (()=>{const b=document.querySelector('#okInfoModalBtn'); if(b&&b.offsetParent){b.click();return 'MODAL_OK'} return 'NO_MODAL'})()"; run "wait 2000"
  for sec in $(seq 1 14); do
    run "capture"
    ids=$(run "eval $ADDEDIT" | python3 -c "import sys,json; print(' '.join(json.loads(sys.stdin.read() or '[]')))" 2>/dev/null)
    echo "  section $sec add/edit: $ids"
    for id in $ids; do
      run "eval (()=>{const e=document.getElementById('$id'); if(!e) return 'NOID'; e.scrollIntoView({block:'center'}); e.click(); return 'OPENED $id';})()"; run "wait 3000"; run "capture"
      r=$(run "eval $CLOSE_MODAL"); echo "    $id -> $r"; run "wait 1500"
    done
    r=$(run "eval ${CLICK_TEXT//TXT/\"Next\"}"); echo "  next -> $r"
    [[ "$r" == *NONE* || "$r" == ERR* ]] && break
    run "wait 5000"
  done
  run "capture"
done
echo DONE $(date +%T)
