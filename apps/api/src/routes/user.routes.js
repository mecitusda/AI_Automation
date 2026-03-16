import express from "express";

const router = express.Router();

router.get("/payments", (req, res) => {
  const payment = {
    paymentId: "pay_48291",
    amount: 1250,
    currency: "TRY",
    status: "success",
    customer: {
      id: "u_123",
      name: "Ahmet Yılmaz",
      email: "ahmet@example.com"
    },
    order: {
      id: "ord_883",
      product: "Pro Plan",
      price: 1250
    },
    createdAt: new Date()
  };

  res.json(payment);
});

router.get("/pending", (req, res) => {

  const payments =  [
    {
      paymentId: "p1",
      email: "user1@mail.com",
      amount: 500
    },
    {
      paymentId: "p2",
      email: "mirac_usda@hotmail.com",
      amount: 900
    },
    {
      paymentId: "p3",
      email: "usda.mecit@gmail.com",
      amount: 1200
    }
  ];

  res.json(payments);

});

router.post("/create", (req, res) => {

  const { email, amount } = req.body;

  const payment = {
    paymentId: "pay_" + Math.floor(Math.random() * 100000),
    amount: amount || 100,
    currency: "TRY",
    status: "pending",
    customer: {
      id: "u_" + Math.floor(Math.random() * 1000),
      email: email || "test@mail.com"
    },
    createdAt: new Date()
  };

  res.json({
    message: "Payment created",
    payment
  });

});
export default router;
