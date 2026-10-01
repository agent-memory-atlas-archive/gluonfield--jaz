export type BotShape = 'circle' | 'blob' | 'squircle' | 'pill' | 'triangle' | 'hex' | 'cloud' | 'drop'
export type BotColor = 'white' | 'brown' | 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray'

export interface BotAvatar {
  shape: BotShape
  color: BotColor
}
