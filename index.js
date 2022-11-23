const express = require('express');
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require('jsonwebtoken');
const req = require('express/lib/request');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.pqymyou.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next){
  
  const authHeader = req.headers.authorization;
  console.log(authHeader)
  if(!authHeader){
    return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];
  

  jwt.verify(token, process.env.ACCESS_TOKEN,
    function(err, decoded){
      if(err){
        return res.status(403).send({message: 'forbidden access'})
        
      }
      req.decoded = decoded;
      next();
    })

}

async function run(){
  try{

    const appointmentOptionCollection = client.db('doctorPortal').collection('appointment');

    const bookingCollection = client.db("doctorPortal").collection("bookings");
    const usersCollection = client.db("doctorPortal").collection("users");
    const doctorsCollection = client.db("doctorPortal").collection("doctors");
     const paymentsCollection = client.db("doctorPortal").collection("payments");

    const verifyAdmin = async (req, res, next) =>{
      // console.log("verifyAdmin", req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = {email: decodedEmail};
      const user = await usersCollection.findOne(query);
      if(user?.role !== 'admin'){
        return res.status(403).send({message: 'forbidden access'})
      }
      next();
    }

    app.get('/appointmentOptions', async(req, res) =>{
      const date = req.query.date;
      console.log(date);
      const query ={};
      const options = await appointmentOptionCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date }
      const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
      options.forEach(option =>{
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
        const bookedSlots = optionBooked.map(book => book.slot)
        const remainingSlots = option.slots.filter(slot =>!bookedSlots.includes(slot))
        option.slots = remainingSlots;
      })
      res.send(options);
    })

    

    app.get('/appointmentSpecialty', async (req, res) =>{
      const query ={}
      const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
      res.send(result);
    })

    app.get('/bookings', verifyJWT, async(req, res) =>{
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      console.log(email, decodedEmail)
      if(email !== decodedEmail){
        return res.status(403).send({message: 'forbidden access'});
      }

      const query = {email: email};
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    })

    app.get('/bookings/:id', async(req, res) =>{
         const id = req.params.id;
         const query = {_id: ObjectId(id)};
         const booking = await bookingCollection.findOne(query);
         res.send(booking)
    })



    app.post('/bookings', async(req, res) =>{
      const booking = req.body
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if(alreadyBooked.length){
        const message = `you already have a booking on ${booking.appointmentDate}`
        return res.send({acknowledged: false, message})
      }

      const result = await bookingCollection.insertOne(booking); 
      res.send(result);
    })

    app.post('/payments', async(req, res) =>{
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = {_id: ObjectId(id)}
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updateResult = await bookingCollection.updateOne(filter, updateDoc);
      
      res.send(result);
    })



    app.post("/create-payment-intent", async(req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'inr',
        amount: amount,
        "payment_method_types":[
          'card'
        ]
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    });

app.get('/jwt', async(req, res) =>{
  const email = req.query.email;
  const query = {email: email}
  const user = await usersCollection.findOne(query);
  if(user){
    const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {expiresIn: '2day'})
    return res.send({accessToken: token});
  }
  
  res.status(403).send({accessToken: ''})
})



    app.post('/users', async(req, res) =>{
      const user =req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    })

    app.get('/users/admin/:email', async(req, res) =>{
      const email = req.params.email;
      const query = { email }
      const user = await usersCollection.findOne(query);
      res.send({isAdmin: user?.role === 'admin'});
    })



    app.get('/users', async(req, res) =>{
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })
    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res) =>{
      
      const id = req.params.id;
      const filter = {_id: ObjectId(id)}
      const options = {upsert: true};
      const updateDoc ={
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    })
    // data update 
    // app.get('/addPrice', async (req, res) =>{
    //     const filter = {}
    //     const option = {upsert: true}
    //     const updateDoc = {
    //       $set: {
    //         price: 99
    //       }
    //     }
    //     const result = await appointmentOptionCollection.updateMany(filter, updateDoc, option)
    //     res.send(result);
    // })





    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query ={};
      const doctor = await doctorsCollection.find(query).toArray();
      res.send(doctor);
    });

app.delete("/doctors/:id", verifyJWT,verifyAdmin, async (req,res)=>{

      const id = req.params.id;
      const filter = {_id: ObjectId(id)};
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
     });



    app.post('/doctors', verifyJWT,verifyAdmin, async(req, res) =>{
      const doctor =req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    })
}
  finally{

  }
}
run().catch(console.log);

app.get('/', async(req, res) =>{
    res.send('doctors portal server is running');

})

app.listen(port, () => console.log(`Doctor portal running on ${port}`));
