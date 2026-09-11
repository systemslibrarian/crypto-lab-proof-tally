import { CountCircuit, SumCircuit } from '../flp/circuit'
import { Prio3 } from './core'

export function createPrio3Count(): Prio3 {
  return new Prio3({ id: 0x00000001, name: 'Prio3Count', circuit: new CountCircuit() })
}

export function createPrio3Sum(maximum: bigint): Prio3 {
  return new Prio3({ id: 0x00000002, name: 'Prio3Sum', circuit: new SumCircuit(maximum) })
}