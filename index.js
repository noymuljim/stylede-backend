const express = require('express')
const app = express()


const cors = require('cors');
require('dotenv').config();


const stripe = require('stripe')(process.env.STRIPE_SECRET);



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');



const port = process.env.PORT || 3000;


var admin = require("firebase-admin");


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const crypto = require('crypto');


function generateTrackingId() {
    const prefix = 'PRCL';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${prefix}-${date}-${random}`;
}

//middle
app.use(express.json())
app.use(cors())
//middle 2

const verifyFBToken = async (req, res, next) => {
    console.log('header from middle= ', req.headers.authorization)

    const token = req.headers.authorization;


    if (!token) {
        return res.status(401).send({ message: 'unauthorize access' })
    }

    try {
        const tokenId = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(tokenId)
        console.log('decoded in token', decoded)

        req.decodedEmail = decoded.email
        next()
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorize access' })
    }

}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@simple-curd-server.rjfvned.mongodb.net/?appName=simple-curd-server`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.get('/test', (req, res) => {
  res.send('TEST ROUTE WORKING');
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        console.log('Mongo connected');
        await client.connect();


        const db = client.db("StyleDecoreProject")
        const serviceCollection = db.collection('services')
        const userCollection = db.collection('users')
        const bookingCollection = db.collection('bookings')
        const paymentCollection = db.collection('payments')
        const decoratorCollection = db.collection('decorators')
        const trackingsCollection = db.collection('trackings')
        //middle 3
        const verifyAdmin = async (req, res, next) => {
            const email = req.decodedEmail;

            const query = { email }
            const user = await userCollection.findOne(query)

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next()
        }


        //function

        const logTracking = async (trackingId, status) => {
            const log = {
                trackingId,
                status,
                details: status.split('_').join(' '),
                createdAt: new Date()
            }
            const result = await trackingsCollection.insertOne(log)
            return result;
        }


        //traking related api
        app.get('/trackings/:trackingId/logs', async (req, res) => {
            const trackingId = req.params.trackingId;
            const query = { trackingId };
            const result = await trackingsCollection.find(query).toArray();
            res.send(result)

        })
        //decorators
        app.post('/decorators', async (req, res) => {
            const decorator = req.body;
            decorator.status = 'pending';
            decorator.createdAt = new Date();

            const result = await decoratorCollection.insertOne(decorator);
            res.send(result)
        })


        app.get('/decorators', async (req, res) => {

            const { status, workStatus, district } = req.query;

            const query = {};
            const options = { sort: { createdAt: -1 } }

            if (status) {
                query.status = status;
            }
            if (workStatus) {
                query.workStatus = workStatus;
            }
            if (district) {
                query.district = district;
            }
            const cursor = decoratorCollection.find(query, options)
            const result = await cursor.toArray();
            res.send(result)
        })
        app.patch('/decorators/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const status = req.body.status;
            const updatedDoc = {
                $set: {
                    status: status,
                    workStatus: 'available'
                }
            }
            const result = await decoratorCollection.updateOne(query, updatedDoc);



            if (status === 'approved') {
                const email = req.body.email;
                const userQuery = { email }
                const updateUser = {
                    $set: {
                        role: 'decorator'
                    }
                }
                const userResult = await userCollection.updateOne(userQuery, updateUser)
            }
            res.send(result);
        })
        app.delete('/decorators/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const result = await decoratorCollection.deleteOne(query);
            res.send(result);
        });
        //booking API
        app.post('/bookings', async (req, res) => {
            const booking = req.body
            const trackingId = generateTrackingId()

            booking.createdAt = new Date()

            booking.trackingId = trackingId

            logTracking(trackingId, 'booking_created');
            const result = await bookingCollection.insertOne(booking)
            res.send(result)

        })

        app.get('/bookings', async (req, res) => {
            const query = {}
            const { email, bookingStatus } = req.query

            if (bookingStatus) {
                query.bookingStatus = bookingStatus;
            }
            if (email) {
                query.userEmail = email;
            }
            const options = { sort: { createdAt: -1 } }

            const cursor = bookingCollection.find(query, options)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.get('/allBookings', async (req, res) => {

            const page = parseInt(req.query.page) || 1;
            const size = parseInt(req.query.size) || 5;


            const query = {}
            const options = { sort: { createdAt: -1 } }

            const cursor = bookingCollection.find(query, options).skip((page - 1) * size)
                .limit(size)

            const result = await cursor.toArray()
            res.send(result)
        })
        app.get('/allBookingsCount', async (req, res) => {
            const count = await bookingCollection.countDocuments();
            res.send({ count });
        });


        app.get('/bookings/decorator', async (req, res) => {
            const { decoratorEmail, bookingStatus } = req.query;

            const query = {}

            if (decoratorEmail) {
                query.decoratorEmail = decoratorEmail
            }
            if (bookingStatus) {
                query.bookingStatus = bookingStatus
                query.bookingStatus = { $nin: ['Completed'] }
            }

            else {
                query.bookingStatus = bookingStatus
            }
            const cursor = bookingCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);

        })
        app.get('/bookings/decorator/earning', async (req, res) => {
            const { decoratorEmail, bookingStatus } = req.query;

            const query = {}

            if (decoratorEmail) {
                query.decoratorEmail = decoratorEmail
            }
            if (bookingStatus) {
                query.bookingStatus = bookingStatus
                // query.bookingStatus = { $nin: ['Completed'] }
            }

            else {
                query.bookingStatus = bookingStatus
            }
            const cursor = bookingCollection.find(query)
            const result = await cursor.toArray();
            res.send(result);

        })
        // 

        app.patch('/bookings/:id/reject', async (req, res) => {


            const { decoratorId } = req.body;

            // parcel update
            const id = req.params.id;
            const bookingQuery = { _id: new ObjectId(id) };

            const updatedBooking = {
                $set: {
                    bookingStatus: 'panding_assign'
                },
                $unset: {
                    decoratorId: "",
                    decoratorName: "",
                    decoratorEmail: ""
                }
            };

            const bookingResult = await bookingCollection.updateOne(bookingQuery, updatedBooking);

            // decorator update
            const decoratorQuery = { _id: new ObjectId(decoratorId) };

            const decoratorUpdatedDoc = {
                $set: {
                    workStatus: 'available'
                }
            };

            const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);

            res.send({ bookingResult, decoratorResult });
        });


        // 

        app.delete('/bookings/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await bookingCollection.deleteOne(query);
            res.send(result)
        })


        app.patch('/bookings/:id', async (req, res) => {
            const { decoratorId, decoratorEmail, decoratorName, trackingId } = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    bookingStatus: 'decorator_assigned',
                    decoratorId: decoratorId,
                    decoratorName: decoratorName,
                    decoratorEmail: decoratorEmail

                }
            }
            const result = await bookingCollection.updateOne(query, updatedDoc)

            const decoratorQuery = { _id: new ObjectId(decoratorId) }
            const decoratorUpdatedDoc = {
                $set: {
                    workStatus: 'Task_assigned'
                }
            }
            const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);
            logTracking(trackingId, 'decorator_assigned')

            res.send(decoratorResult)
        })


        //multiple same link thakle specific kore dite hbe

        app.patch('/bookings/:id/status', async (req, res) => {

            const { bookingStatus, decoratorId, trackingId } = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updatedDoc = {
                $set: {
                    bookingStatus: bookingStatus
                }
            }

            if (bookingStatus === 'Completed') {
                const decoratorQuery = { _id: new ObjectId(decoratorId) }
                const decoratorUpdatedDoc = {
                    $set: {
                        workStatus: 'available'
                    }
                }
                const decoratorResult = await decoratorCollection.updateOne(decoratorQuery, decoratorUpdatedDoc);

            }
            const result = await bookingCollection.updateOne(query, updatedDoc)
            logTracking(trackingId, bookingStatus)
            res.send(result)


        })


        app.get('/bookings/today-schedule', async (req, res) => {
            const { decoratorEmail } = req.query;

            const today = new Date().toISOString().split('T')[0];

            const result = await bookingCollection.find({
                decoratorEmail,
                date: today
            }).toArray();

            res.send(result);
        });


        //user API
        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = 'user'

            const email = user.email
            const userExist = await userCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'user exist' })
            }
            user.createdAt = new Date()
            const result = await userCollection.insertOne(user)
            res.send(result)

        })


        app.get('/users', verifyFBToken, async (req, res) => {
            const searchText = req.query.searchText;
            const query = {}
            if (searchText) {

                query.$or = [
                    { displayName: { $regex: searchText, $options: 'i' } },

                    { email: { $regex: searchText, $options: 'i' } },
                ]
            }
            const cursor = userCollection.find(query).sort({ createdAt: -1 }).limit(7)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const roleInfo = req.body;

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const updateDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await userCollection.updateOne(query, updateDoc)
            res.send(result);
        })




        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollection.findOne(query);

            res.send({ role: user?.role || 'user' })

        })
        //my-service
        app.get('/my-services', async (req, res) => {
            const email = req.query.email;
            const result = await serviceCollection.find({ createdBy: email }).toArray();
            res.send(result);
        });
        app.get('/services/:id', async (req, res) => {

            const id = req.params.id;
            const query = { _id: new ObjectId(id) }

            const result = await serviceCollection.findOne(query);

            res.send(result);
        });

        app.patch('/services/:id', async (req, res) => {

            const id = req.params.id;
            const updatedData = req.body;
            const query = { _id: new ObjectId(id) }


            const result = await serviceCollection.updateOne(
                query,
                {
                    $set: updatedData
                }
            );

            res.send(result);
        });

        // services API
        app.post('/services', async (req, res) => {
            const service = req.body

            const result = await serviceCollection.insertOne(service)
            res.send(result)
        })


        app.get('/services', async (req, res) => {
            const result = await serviceCollection.find().limit(6).toArray();
            res.send(result);
        });
        app.get('/allServices', async (req, res) => {
            const searchText = req.query.searchText;
            const query = {};

            if (searchText) {
                query.serviceName = { $regex: searchText, $options: 'i' };

            }

            const result = await serviceCollection.find(query).toArray();
            res.send(result);
        });


        app.get('/serviceDetails/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) };

            const result = await serviceCollection.findOne(query);

            res.send(result);
        });

        app.delete('/services/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await serviceCollection.deleteOne(query);

            res.send(result);
        });



        //payment API
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.cost) * 100

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.serviceName
                            },
                        },

                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.userEmail,
                mode: 'payment',
                metadata: {
                    bookingId: paymentInfo.bookingId,
                    serviceName: paymentInfo.serviceName,
                    trackingId: paymentInfo.trackingId


                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });
            console.log(session)
            res.send({ url: session.url })
        })


        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            console.log(sessionId);

            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query)

            if (paymentExist) {
                return res.send({
                    messsage: 'already exist', transactionId,
                    trackingId: paymentExist.trackingId
                })
            }



            // const trackingId = generateTrackingId()
            const trackingId = session.metadata.trackingId


            if (session.payment_status === "paid") {
                const id = session.metadata.bookingId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId,
                        bookingStatus: 'panding_assign'



                    }
                }
                const result = await bookingCollection.updateOne(query, update)



                const payment = {
                    amount: session.amount_total / 100,
                    curency: session.currency,
                    customerEmail: session.customer_email,
                    bookingId: session.metadata.bookingId,
                    serviceName: session.metadata.serviceName,

                    transactionId: session.payment_intent,

                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId,



                }
                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment)


                    // logTracking(trackingId, 'panding_assign')

                    const trackingExist = await trackingsCollection.findOne({
                        trackingId: trackingId,
                        status: 'booking_paid'
                    });

                    if (!trackingExist) {
                        await logTracking(trackingId, 'booking_paid');
                    }



                    res.send({
                        success: true,
                        modifyParcel: result,
                        paymentInfo: resultPayment,
                        trackingId: trackingId,
                        transactionId: session.payment_intent
                    })
                }

            }




            res.send({ success: false })
        })



        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const query = {}
            // console.log("headers: ", req.headers)



            if (email) {
                query.customerEmail = email;

                //check emial 
                if (email !== req.decodedEmail) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const cursor = paymentCollection.find(query).sort({ paidAt: -1 })
            const result = await cursor.toArray();
            res.send(result)
        })



        //admin earning
        app.get('/bookings/admin/earnings', async (req, res) => {
            const completedBookings = await bookingCollection.find({ bookingStatus: 'Completed' }).toArray();

            res.send(completedBookings);
        });

        //pipeline

        app.get('/bookings/booking-status/stats', async (req, res) => {
            const pipeline = [
                {
                    $match: {
                        bookingStatus: { $ne: null }
                    }
                },
                {
                    $group: {
                        _id: '$bookingStatus',
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        status: '$_id',
                        count: 1,

                    }
                }
            ]
            const result = await bookingCollection.aggregate(pipeline).toArray();
            res.send(result)
        })





        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('running style server!')
})

app.listen(port, () => {
  console.log(`Serverrr running on port ${port}`);
});

