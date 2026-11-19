## ADDED Requirements

### Requirement: Traditional conversion keeps the adverb 只

The conversion of recognized or model text to Traditional Chinese SHALL write 只 rather than 隻 where the character is the adverb "only": when the converted 隻 is directly followed by 有, 是, 要, 能, 會, 好, 在, 不 or 得 it SHALL become 只, but only where the text given to the conversion had 只 there (a 隻 already written, as in 船隻, stays), and not after a numeral, 萬, 億, 幾, 每, 這, 那, 哪, 某, 整, 數, 半, 多 or 船, where it is a measure word.

#### Scenario: 不是只有

- **WHEN** 不是只有這樣 is converted
- **THEN** the result is 不是只有這樣

##### Example: conversions

| Input | Output |
| ----- | ------ |
| 不是只有这样 | 不是只有這樣 |
| 一只猫 | 一隻貓 |
| 只有一只 | 只有一隻 |
| 两只手都不是只要 | 兩隻手都不是只要 |
| 一只会飞的鸟 | 一隻會飛的鳥 |
| 船只不得进入港区 | 船隻不得進入港區 |
| 哪只会飞 | 哪隻會飛 |
| 船隻在港口 | 船隻在港口 |
