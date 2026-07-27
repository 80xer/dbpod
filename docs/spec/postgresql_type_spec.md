# PostgreSQL 타입 및 값 직렬화 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 목적

PostgreSQL 값을 Rust Core, Tauri IPC, React Result Store, Grid 표시, 편집과 클립보드 사이에서 정밀도와 의미 손실 없이 전달하는 형식을 정의한다.

## 2. 원칙

- `NULL`, 빈 문자열과 `DEFAULT`를 구분한다.
- JavaScript 안전 범위를 넘는 숫자를 `number`로 변환하지 않는다.
- timezone이 없는 값에 임의 timezone을 붙이지 않는다.
- JSON 숫자를 일반 `JSON.parse`로 영구 변환하지 않는다.
- binary는 문자열로 추측하지 않는다.
- PostgreSQL 원본 타입 OID와 타입 이름을 유지한다.
- 알 수 없는 확장 타입은 오류 대신 lossless text fallback을 우선한다.
- 표시 형식과 저장 형식을 분리한다.

## 3. Column metadata

```ts
type ColumnMeta = {
  index: number
  name: string
  pgTypeOid: number
  pgTypeName: string
  category:
    | 'boolean'
    | 'integer'
    | 'decimal'
    | 'float'
    | 'text'
    | 'binary'
    | 'uuid'
    | 'temporal'
    | 'json'
    | 'array'
    | 'enum'
    | 'network'
    | 'range'
    | 'composite'
    | 'unknown'
  source?: {
    relationOid: number
    attributeNumber: number
    schema?: string
    table?: string
    column?: string
  }
  nullable?: boolean
  editable: boolean
  displayFormat?: string
}
```

`nullable`을 result metadata만으로 확정할 수 없으면 `undefined`로 둔다. false로 추측하지 않는다.

## 4. IPC 값 형식

```ts
type DbValue =
  | { kind: 'null' }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'integer'; value: string }
  | { kind: 'decimal'; value: string }
  | { kind: 'float'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'uuid'; value: string }
  | {
      kind: 'temporal'
      temporalType: 'date' | 'time' | 'timetz' | 'timestamp' | 'timestamptz' | 'interval'
      value: string
    }
  | { kind: 'json'; value: string; jsonType: 'json' | 'jsonb' }
  | {
      kind: 'binary'
      encoding: 'base64'
      value?: string
      byteLength: number
      truncated: boolean
      valueHandle?: string
    }
  | {
      kind: 'array'
      dimensions: Array<{ lowerBound: number; length: number }>
      values: DbValue[]
      elementTypeOid: number
    }
  | { kind: 'enum'; value: string; typeName: string }
  | { kind: 'network'; value: string; networkType: string }
  | { kind: 'range'; value: string; rangeType: string }
  | { kind: 'composite'; value: string; typeName: string }
  | { kind: 'unknown'; value: string; typeOid: number; typeName: string }
```

모든 enum은 JSON 직렬화 가능한 tagged union으로 Rust `serde` 모델과 1:1 대응한다.

## 5. 타입별 정책

### 5.1 Boolean

| PostgreSQL | IPC | 표시 | 편집 |
| --- | --- | --- | --- |
| `bool` | boolean | `true` / `false` | checkbox 또는 명시적 selector |

`NULL` boolean은 unchecked와 구분한다.

### 5.2 Integer

| PostgreSQL | IPC |
| --- | --- |
| `int2`, `int4`, `int8`, `oid` | 10진 문자열 |

모든 integer를 문자열로 보내 정밀도 정책을 통일한다. Grid 정렬과 필터는 필요할 때 `BigInt` 또는 arbitrary precision 비교를 사용한다.

### 5.3 Decimal

| PostgreSQL | IPC |
| --- | --- |
| `numeric`, `decimal`, `money` | canonical 문자열 |

- exponential notation을 임의로 decimal number로 변환하지 않는다.
- scale의 trailing zero를 원본 표시 옵션에서 유지할 수 있다.
- locale grouping은 display layer에서만 적용한다.
- copy 기본값은 locale 없는 canonical text다.

### 5.4 Float

`float4`, `float8`은 다음을 표현하기 위해 문자열로 전송한다.

- finite decimal
- `NaN`
- `Infinity`
- `-Infinity`

Grid numeric sort는 특수값 정책을 명시적으로 적용한다.

### 5.5 Text

다음은 UTF-8 문자열로 전달한다.

- `text`
- `varchar`
- `char`
- `name`
- `citext`
- XML의 text representation

NUL 또는 invalid server encoding 문제는 decode error로 표시하고 binary로 오인하지 않는다.

큰 text:

- inline soft limit: 256KiB
- 초과 시 preview와 `valueHandle` 제공
- 전체 값은 명시적인 `result_value_fetch`로 읽는다.

### 5.6 UUID

- lowercase canonical UUID text로 전달한다.
- 표시는 설정에 따라 원본 case를 보존할 수 있으나 비교는 canonical 값으로 한다.

### 5.7 Date와 time

| 타입 | canonical IPC |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `time` | `HH:mm:ss[.fraction]` |
| `timetz` | `HH:mm:ss[.fraction]±HH:mm` |
| `timestamp` | `YYYY-MM-DDTHH:mm:ss[.fraction]`, timezone 없음 |
| `timestamptz` | ISO-8601 instant, 기본 UTC `Z` |
| `interval` | PostgreSQL canonical text |

정책:

- `timestamp`에 client timezone을 적용하지 않는다.
- `timestamptz` 표시는 `UTC`, `server`, `local` 중 사용자가 선택할 수 있다.
- 편집 input은 원본 타입의 timezone 의미를 유지한다.
- DST ambiguity가 있으면 저장 전에 offset을 확인한다.
- PostgreSQL infinity date/timestamp는 문자열 특수값으로 보존한다.

### 5.8 JSON/JSONB

- raw UTF-8 JSON text를 IPC에 저장한다.
- 영구 row state는 일반 JavaScript object로 변환하지 않는다.
- pretty view는 lossless JSON parser 또는 읽기 전용 text formatter를 사용한다.
- `jsonb` key order가 PostgreSQL에서 변경될 수 있음을 표시한다.
- 편집 저장 전에 JSON syntax를 검증한다.

### 5.9 Binary

`bytea`:

- IPC encoding은 base64
- 기본 inline limit은 256KiB
- 초과 값은 preview 없이 length와 `valueHandle`만 전달 가능
- Grid에는 `<binary 1.2 MB>`처럼 표시
- Quick View에서 hex, image 또는 UTF-8 시도를 사용자가 선택
- copy 기본값은 hex 또는 base64 중 설정 가능

### 5.10 Array

- PostgreSQL lower bound와 각 dimension length를 보존한다.
- values는 row-major flat array로 전달한다.
- array `NULL` element와 empty string을 구분한다.
- Grid 기본 표시는 PostgreSQL array text와 유사한 compact form이다.
- Quick View에서 tree/table 형태를 제공한다.
- 알려지지 않은 element type은 array 전체 text fallback을 사용할 수 있다.

### 5.11 Enum과 domain

- enum label과 type name을 보존한다.
- 편집 UI는 catalog에서 가능한 label을 읽어 selector를 제공한다.
- domain은 base type으로 decode하되 domain type name과 constraint context를 metadata에 유지한다.

### 5.12 Network

다음 타입은 canonical text로 전달한다.

- `inet`
- `cidr`
- `macaddr`
- `macaddr8`

### 5.13 Range

range와 multirange는 MVP에서 canonical PostgreSQL text로 전달한다. 표시와 복사는 지원하지만 구조적 편집은 후속 범위다.

### 5.14 Composite와 unknown

- 가능한 경우 PostgreSQL text representation을 사용한다.
- type OID와 name을 반드시 포함한다.
- unknown 값은 읽기·복사가 가능하다.
- 안전한 encoder가 없으면 편집은 비활성화한다.

## 6. `NULL`, empty와 `DEFAULT`

### 6.1 Result

- SQL `NULL`: `{ kind: 'null' }`
- empty text: `{ kind: 'text', value: '' }`
- `DEFAULT`: 저장된 row 값이 아니므로 조회 결과에 별도 value로 존재하지 않는다.

### 6.2 Insert draft

insert UI는 세 상태를 가진다.

```ts
type InsertCellDraft =
  | { mode: 'value'; value: DbValue }
  | { mode: 'null' }
  | { mode: 'default' }
```

- `default`는 INSERT column 목록에서 해당 column을 제외하거나 `DEFAULT` keyword를 생성한다.
- `null`은 bind parameter `NULL`로 처리한다.
- 빈 문자열은 text value로 처리한다.

## 7. 표시와 정렬

- 원본 `DbValue`는 변경하지 않는다.
- formatting 결과는 별도 memoized display value다.
- 정렬은 category별 comparator를 사용한다.
- `NULL` 위치는 기본 last이며 사용자가 변경할 수 있다.
- arbitrary Query Result의 client sort는 로딩된 row에만 적용됨을 표시한다.
- Table Data Tab sort는 server-side query로 수행한다.

## 8. 클립보드와 내보내기

### 8.1 기본 copy

- column delimiter: tab
- row delimiter: platform newline
- text quote: TSV 규칙에 따라 필요 시 quote
- `NULL`: 설정 가능한 marker, 기본 `NULL`
- empty string: 빈 field
- binary: `<binary N bytes>`가 아니라 사용자가 선택한 hex/base64
- timestamp: canonical 또는 선택한 display timezone

### 8.2 CSV

- RFC 4180 호환을 목표로 한다.
- formula injection 방어 모드를 기본 활성화한다.
- `=`, `+`, `-`, `@`로 시작하는 text는 안전한 export 옵션에서 escape한다.
- raw export는 명시적 선택과 경고를 요구한다.

## 9. 편집 parsing

- parsing은 column의 PostgreSQL type을 기준으로 Rust Core에서 최종 검증한다.
- React validation은 빠른 피드백용이며 권위 있는 검증이 아니다.
- locale formatting이 포함된 값을 DB bind value로 직접 보내지 않는다.
- decimal, integer와 temporal은 canonical input으로 변환 후 전달한다.
- server가 반환한 canonical 값을 저장 성공 후 다시 반영한다.

## 10. 오류

값 decode 실패는 전체 query를 숨기지 않는다.

```ts
type CellDecodeError = {
  rowIndex: number
  columnIndex: number
  pgTypeOid: number
  code: 'UNSUPPORTED_TYPE' | 'INVALID_ENCODING' | 'VALUE_TOO_LARGE' | 'DECODE_FAILED'
  message: string
}
```

- 안전한 text fallback이 있으면 `unknown`으로 표시한다.
- fallback도 불가능하면 error cell을 표시하고 다른 cell은 유지한다.
- 오류 메시지에 전체 민감 값을 포함하지 않는다.

## 11. 수용 조건

- `int8` 최대·최소값이 정밀도 손실 없이 round-trip된다.
- 50자리 `numeric`과 scale이 보존된다.
- `NaN`, positive/negative infinity가 표시된다.
- timezone 없는 timestamp가 client timezone 때문에 변하지 않는다.
- timestamptz가 동일한 instant로 round-trip된다.
- JSON의 큰 integer가 일반 `number`로 손실되지 않는다.
- multidimensional array의 dimension과 `NULL` element가 보존된다.
- 1MiB `bytea`가 Grid 전체를 block하지 않는다.
- `NULL`, empty string과 insert `DEFAULT`가 서로 다르게 저장된다.
- unknown extension type이 query 전체 실패 없이 text fallback으로 표시된다.

