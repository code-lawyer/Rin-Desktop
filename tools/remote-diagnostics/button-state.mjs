// A device adapter boundary: logical button edges, never global shortcuts.
const BUTTONS = Object.freeze({Up:'up',Down:'down',Left:'left',Right:'right',Return:'confirm',Home:'home',Apps:'menu',F5:'voice'});
export class RemoteButtonState {
  constructor(generation) { this.generation=generation; this.held=new Set(); this.suppressed=0; }
  accept(event) {
    if(event?.source!=='rc003' || event.generation!==this.generation || !['down','up'].includes(event.edge)) return null;
    const button=BUTTONS[event.key]; if(!button) return null;
    if(event.edge==='down') {
      if(this.held.has(button)){this.suppressed++;return null;}
      this.held.add(button); return {button,phase:'press',generation:this.generation};
    }
    if(!this.held.delete(button))return null;
    return {button,phase:'release',generation:this.generation};
  }
  disconnect(nextGeneration) {
    const events=[...this.held].map(button=>({button,phase:'cancel',generation:this.generation}));
    this.held.clear();this.generation=nextGeneration;return events;
  }
}
