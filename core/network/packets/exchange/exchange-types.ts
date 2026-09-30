export enum ExchangeClientAction {
  BeginExchange = 0,
  AddItem = 1,
  AddStackableItem = 2,
  SetGold = 3,
  Cancel = 4,
  Accept = 5,
}

export enum ExchangeServerEvent {
  Started = 0,
  QuantityPrompt = 1,
  ItemAdded = 2,
  GoldAdded = 3,
  Cancelled = 4,
  Accepted = 5,
}

export enum ExchangeParty {
  You = 0,
  Them = 1,
  /** Packet captures use subtype 2 for the server's final, successful exchange result. */
  Completed = 2,
}
