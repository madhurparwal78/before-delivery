export const ORDERS_CSV = `Order,Date,Stockist ID,Product,Category,Units,Sales
1,2027-01-04,S1,Moss Sencha,Green,4,120
2,2027-01-06,S1,Ember Assam,Black,2,50
3,2027-01-11,S2,Moss Sencha,Green,3,90
4,2027-01-13,S3,Quiet Mint,Herbal,5,75
5,2027-01-20,S3,Ember Assam,Black,6,150
6,2027-02-02,S4,Quiet Mint,Herbal,2,30
7,2027-02-03,S4,Moss Sencha,Green,1,30
8,2027-02-09,S5,Ember Assam,Black,8,200
9,2027-02-10,S5,Dusk Blend,Black,4,80
10,2027-02-17,S1,Dusk Blend,Black,5,100
11,2027-02-24,S2,Quiet Mint,Herbal,6,90
12,2027-03-01,S3,Moss Sencha,Green,7,210
13,2027-03-03,S5,Quiet Mint,Herbal,3,45
14,2027-03-08,S1,Quiet Mint,Herbal,2,30
15,2027-03-15,S9,Dusk Blend,Black,1,20
16,2027-03-16,S4,Ember Assam,Black,,
`;

export const STOCKISTS_CSV = `Stockist ID,Stockist,Region,Tier,Target
S1,Alder Cup,North,Gold,900
S2,Birch Kettle,North,Silver,500
S3,Cedar Pot,East,Gold,700
S4,Dune Mug,South,Silver,400
S5,Elm Leaf,West,Gold,600
`;

export const SAMPLE_SOURCE_NAME = 'Fernhollow Tea';

export function generatedCsv(rows: number): string {
  const lines = ['Id,Group,Value'];
  for (let i = 1; i <= rows; i += 1) lines.push(`${i},G${i % 10},${i % 100}`);
  return `${lines.join('\n')}\n`;
}
