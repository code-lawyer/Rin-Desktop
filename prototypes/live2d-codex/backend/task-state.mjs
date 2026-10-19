// Shared by the controller and views; pending submissions remain a controller concern.
const BUSY = new Set(['starting', 'working', 'waiting', 'stopping', 'configuring']);
export const isTaskBusy = state => BUSY.has(state?.status);
