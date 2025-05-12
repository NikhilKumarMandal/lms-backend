const paypal = require("../../helpers/paypal");
const Order = require("../../models/Order");
const Course = require("../../models/Course");
const StudentCourses = require("../../models/StudentCourses");

const createOrder = async (req, res) => {
  try {
    const {
      userId,
      userName,
      userEmail,
      orderStatus,
      paymentMethod,
      paymentStatus,
      orderDate,
      paymentId,
      payerId,
      instructorId,
      instructorName,
      courseImage,
      courseTitle,
      courseId,
      coursePricing,
    } = req.body;

    // Validate required fields
    if (!userId || !courseTitle || !courseId || !coursePricing) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
      });
    }

    const formattedPrice = parseFloat(coursePricing).toFixed(2);

    // Safely use CLIENT_URL from env, fallback to localhost
    const baseUrl = process.env.CLIENT_URL || "https://lms-ui-gamma.vercel.app";

    const create_payment_json = {
      intent: "sale",
      payer: {
        payment_method: "paypal",
      },
      redirect_urls: {
        return_url: `${baseUrl}/payment-return`,
        cancel_url: `${baseUrl}/payment-cancel`,
      },
      transactions: [
        {
          item_list: {
            items: [
              {
                name: courseTitle,
                sku: String(courseId),
                price: formattedPrice,
                currency: "USD",
                quantity: 1,
              },
            ],
          },
          amount: {
            currency: "USD",
            total: formattedPrice,
          },
          description: courseTitle,
        },
      ],
    };

    console.log("PayPal Payload:", JSON.stringify(create_payment_json, null, 2));

    paypal.payment.create(create_payment_json, async (error, paymentInfo) => {
      if (error) {
        console.error("PayPal Error:", error.response || error);
        return res.status(500).json({
          success: false,
          message: "Error while creating PayPal payment",
          error: error.response || error,
        });
      }

      const newOrder = new Order({
        userId,
        userName,
        userEmail,
        orderStatus,
        paymentMethod,
        paymentStatus,
        orderDate,
        paymentId,
        payerId,
        instructorId,
        instructorName,
        courseImage,
        courseTitle,
        courseId,
        coursePricing: formattedPrice,
      });

      await newOrder.save();

      const approveUrl = paymentInfo.links.find(
        (link) => link.rel === "approval_url"
      )?.href;

      if (!approveUrl) {
        return res.status(500).json({
          success: false,
          message: "Approval URL not found in PayPal response",
        });
      }

      res.status(201).json({
        success: true,
        data: {
          approveUrl,
          orderId: newOrder._id,
        },
      });
    });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


const capturePaymentAndFinalizeOrder = async (req, res) => {
  try {
    const { paymentId, payerId, orderId } = req.body;

    let order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order can not be found",
      });
    }

    order.paymentStatus = "paid";
    order.orderStatus = "confirmed";
    order.paymentId = paymentId;
    order.payerId = payerId;

    await order.save();

    //update out student course model
    const studentCourses = await StudentCourses.findOne({
      userId: order.userId,
    });

    if (studentCourses) {
      studentCourses.courses.push({
        courseId: order.courseId,
        title: order.courseTitle,
        instructorId: order.instructorId,
        instructorName: order.instructorName,
        dateOfPurchase: order.orderDate,
        courseImage: order.courseImage,
      });

      await studentCourses.save();
    } else {
      const newStudentCourses = new StudentCourses({
        userId: order.userId,
        courses: [
          {
            courseId: order.courseId,
            title: order.courseTitle,
            instructorId: order.instructorId,
            instructorName: order.instructorName,
            dateOfPurchase: order.orderDate,
            courseImage: order.courseImage,
          },
        ],
      });

      await newStudentCourses.save();
    }

    //update the course schema students
    await Course.findByIdAndUpdate(order.courseId, {
      $addToSet: {
        students: {
          studentId: order.userId,
          studentName: order.userName,
          studentEmail: order.userEmail,
          paidAmount: order.coursePricing,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: "Order confirmed",
      data: order,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Some error occured!",
    });
  }
};

module.exports = { createOrder, capturePaymentAndFinalizeOrder };
