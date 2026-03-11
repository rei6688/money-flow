import { Person } from '@/types/moneyflow.types'

type PersonRouteLike = Pick<Person, 'id' | 'pocketbase_id'>

export function getPersonRouteId(person: PersonRouteLike): string {
  const pbId = person.pocketbase_id?.trim()
  if (pbId) return pbId
  return person.id
}
