# Most important naming conventions ! 
wherever possible adhere to these naming conventions. 
// stick to the following naming conventions  

# variable names
all have prefixes

v_ => 'value' a variable with a 'unknown' type

n_ => numnbers , eg. a.map((n_idx, v)=>{...})

b_ => boolean 

o_ => object

a_ => array

f_ => functions, yes also functions are variables, like let f_test = ()=>{return 'test'}

define all functions with a variable declaration keyword for example 

let f_test = function(){return 'test'}

a_n_ => an array containing numbers eg. [1,2,3]

a_o_ => an array containing objects eg. [{},{},{}]

a_v_ => an array containign mixed datatypes [{...}, 1, "hallo"]

# no classes !
instead of class 'O_person' 
```js 

  class O_person {

    constructor(s_name, n_age) {

      this.s_name = s_name;

      this.n_age = n_age;

    }

  }

```
we do 
```js
let f_o_person = function(s_name, n_age){
   return {
      s_name, 
      n_age
   }
}
```
# function naming 
if a function returns nothing 
```js
let f_calculate = function(a, b){
   globalThis.c = a+b;
}
```
the second prefix is the return value of the function
```js
let f_n_sum = function(n_a, n_b){
   return n_a + n_b;
}
let f_b_in_array = function(a_s, s){
   return a_s.includes(s);
}
```


# no plural words
never ever use plural form of words. for example there is no 'users' array , but a 'a_o_user'
there is no 'numbers' array but a 'a_n_number'

example: 'hans' would be the value, we could use 's_name' as a variable name
['hans', 'gretel', 'ueli', 'jasmin'] would be the value 
'a_s_name' would be the variable name, since this is an array of names, 
so 'a_s_names' is wrong, it is an array 'a_', containing 's_name' variables, so 'a_s_name'! 

```js
let a_o_user = [{s_name: 'hans'}, {s_name: 'gretel'}]

let a_n_number = [1,2,3];

let a_s_name = ['hans', 'gretel', 'ueli', 'jasmin'];

let a_f_callback = [(s)=>{return `<div>${s}</div>`}, (n)=>{return n*2}]


```
# data relations 

since there are no plural words. there will be no table 'persons' but a table 'a_o_person'. 
id's are named 'n_id' because id's will be simple integer numbers wherever possible , if this is not possible (for example PostgreSQL) 
the id will be named 's_id' since this a uuid which includes characters not only digits. 
the foreign key of an id will be called n_{object_name}_n_id
so for example like this one person has many fingers. (one to many)
O_person
   -n_id, 
   -s_name
O_finger 
   -n_o_person_n_id
   -s_name
   
# naming order
the more basic a thing is the more in front of the name it comes
we do not do 'filtered_users' but 'a_o_user__filtered'
we do not do 'o_test_user' but 'o_user__test'

the last thing: try to always 'group' variable names, so if the values are similar but the variable names 

have to be distinguished always use the basic / more general variable name in front of it , for example 



let o_person__hans = new O_person('hans', 20);

let o_person__gretel = new O_person('gretel', '19'); 

more exmaples

for example an id is a very generic term so it comes first

n_timeout_id wrong, correct: n_id__timeout

n_frame_id wrong, correct: n_id__frame

n_start_index wrong, correct: n_idx__start, respectively n_idx__end 

n_timestamp_ms wrong, correct: n_ms__timestamp, or n_sec__timestamp or n_min__timestamp

```javascript
let a_o_user = [{s_name: 'hans'}, {s_name: 'gretel'}]
let a_o_user__filtered = a_o_user.filter(o => o.s_name.startsWith('h'));
let o_user__hans = a_o_user__filtered[0];
let o_user__gretel = a_o_user__filtered[1];
```


# abbreviations
for width and height we always use 
'width' => 'n_scl_x' 
'height' => 'n_scl_y' 

```js
//index => idx
//indices / indexes => idxs
//position => pos
//offset => off
//key => k
//element => el
//event => evt
//value = val
//length = len
//size = sz
//count = cnt
//cursor = cur
//pointer = ptr
//
//milliseconds = ms
//microseconds = us
//nanoseconds = ns
//seconds = sec / secs
//timestamp = ts (timestamp)
//delta time = dt (delta time)
//time to live = ttl (time to live)

// math /geometry
// translation  => trn 
// scale => scl
// rotation => rot
```


# normalization and loop indexing (more for mathematicall programming such as shaders)
generally we use 'iterations => its' , 'iteration' => 'it'
in a loop we usualy normalize the iteration variable 'it_nor'
so for example for a loop of polygons 
```js

let n_its_polygons = 5;
let n_its_corners = 3;
let a_a_o_p_polygon = []; // array with array of points  ( representing polygons )
let a_o_p_polygon = []; // array with points (representing polygon)
let radius = 3; 
let n_tau = Math.PI *2;
for(let n_it_polygon = 0; n_it_polygon < n_its_polygons; n_it_polygon++){
   let n_it_nor_polygon = n_it_polygon / n_its_polygon;
   let a_o_p_polygon = [];
   let o_trn = { 
      n_x: Math.sin(n_it_nor_polygon * n_tau) * radius,
      n_y: Math.cos(n_it_nor_polygon * n_tau) * radius 
   }
   for(let n_it_corner = 0; n_it_corner < n_its_corners; n_it_corner++){
      let n_it_nor_corner = n_it_corner / n_its_corners;
      a_o_p_polygon.push(
         { 
            n_x: o_trn.n_x + Math.sin(n_it_nor_corner * n_tau) * radius,
            n_y: o_trn.n_y + Math.cos(n_it_nor_corner * n_tau) * radius 
         }
      );
   }
   a_a_o_p_polygon.push(a_o_p_polygon);
}
```


# example with many conventions applied
```javascript

let f_O_person = function(
    s_name, 
    n_age
){
    return {
        s_name, 
        n_age
    }
}
let o_person__hans = new O_person('hans', 20)
let o_person__gretel = new O_person('gretel', 19)

let o_multidimensional = {
    n: 1, 
    b: true, 
    s: 'this is a string', 
    a_v: [1,'string', true, {n:1}], 
    a_n: [1,2,3],
    s_name: 'hans', 
    a_s_name: ['hans','gretel','jurg','olga'],
    o: {
        n: 2, 
        o: {
            n:2
        },
        a: [1,2,3], 
        b: true, 
    }
}
let f_a_n_idx = function(){
    return [0,1,2,3]
}
let f_add_numbers = function(n1, n2){return n1+n2}

let s_json__o_person = JSON.stringify(new O_person('hans', 20))

let s_f_test = `()=>{return 'test'}`

```

# additional
do NOT: 'b_is_done'
do: 'b_done'

try to not use abbreviations if not needed. if a variable has a very long name that is absolutely ok. the name contains very important information, and this is more important than being lazy and not willing to write down many characters. 
for example 'a_o_person__filtered' is a legit variable. do not try to make up new abbreviations!


---
