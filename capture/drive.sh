#!/bin/bash
# Drive recorder through a form: open URL, then click Next until none left. Captures happen automatically.
cd ~/mca-capture
NEXT_JS='(() => { const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}; const b=[...document.querySelectorAll("button, span, a, div[role=button]")].filter(e=>/^\s*Next\s*$/i.test((e.innerText||"").trim()) && vis(e) && !e.disabled); if(!b.length) return "NO_NEXT"; const t=b[b.length-1]; t.scrollIntoView({block:"center"}); t.click(); return "CLICKED " + b.length + " " + (t.id||t.className||t.tagName); })()'
for spec in "$@"; do
  name=${spec%%|*}; url=${spec#*|}
  echo "=== $name"; rm -f cmd.out
  echo "goto $url" > cmd.txt; sleep 15
  echo "eval (()=>{const b=document.querySelector('#okInfoModalBtn, .modal.show button, .modal.in button'); if(b){b.click(); return 'MODAL_OK'} return 'NO_MODAL'})()" > cmd.txt; sleep 4
  for i in $(seq 1 25); do
    echo "eval $NEXT_JS" > cmd.txt; sleep 6
    r=$(tail -1 cmd.out 2>/dev/null); echo "  next#$i: $r"
    [[ "$r" == *NO_NEXT* || "$r" == ERR* ]] && break
  done
  echo "capture" > cmd.txt; sleep 3
done
echo DONE
