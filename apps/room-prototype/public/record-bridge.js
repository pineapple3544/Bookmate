let shared;
export function setSharedRecords(store) {
  shared = store;
}
export function getSharedRecords() {
  return shared;
}
